// src/agent/loop.js
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { errorMessage } from '../utils/errorMessage.js';
import { assertValidTicketId } from '../utils/ticketId.js';
import { hasExactKnowledgeMatch, normalizeUnknownWord } from '../utils/unknownWord.js';
import { finalizeTicket } from '../database/sqlite.js';
import { deleteResolvedTicket } from '../services/ticketDeletion.js';
import { executeTool, getOpenAITools } from './registry.js';
import { parentPort, threadId } from 'worker_threads';

const FLAG_BY_TOOL = {
  read_ticket: 'wasTicketRead',
  inspect_ticket_attachments: 'wasAttachmentsInspected',
  compare_same_type_tickets: 'wasSameTypeTicketsCompared',
  classify_ticket: 'wasClassified',
  draft_response: 'wasResponseDrafted',
  search_incidents: 'wasIncidentsChecked',
  get_incident_details: 'wasIncidentsChecked',
  search_knowledge_base: 'wasKnowledgeBaseChecked',
  get_knowledge_base_article: 'wasKnowledgeBaseChecked',
  route_ticket: 'wasRouted'
};

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${threadId}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, JSON.stringify(value, null, 2));
    renameSync(tempPath, filePath);
  } catch (error) {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch {}
    }
    throw error;
  }
}

function parseToolResult(content) {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed?.ok === 'boolean') return parsed;
  } catch {}
  return { ok: !String(content).startsWith('Error:') && !String(content).includes('Validation failed') };
}

function repairIncompleteToolBatch(messages, ticketId) {
  let lastAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant' && messages[index].tool_calls?.length) {
      lastAssistantIndex = index;
      break;
    }
    if (messages[index]?.role === 'user') break;
  }
  if (lastAssistantIndex < 0) return false;

  const requested = messages[lastAssistantIndex].tool_calls;
  const answered = new Set(
    messages.slice(lastAssistantIndex + 1)
      .filter((message) => message.role === 'tool')
      .map((message) => message.tool_call_id)
  );
  const missing = requested.filter((call) => !answered.has(call.id));
  for (const call of missing) {
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      name: call.function?.name,
      content: JSON.stringify({
        ok: false,
        terminal: false,
        error: {
          code: 'WORKER_INTERRUPTED',
          message: 'The worker stopped before this tool call completed. Retry if still required.',
          retryable: true
        }
      })
    });
  }
  if (missing.length) {
    logger.warn(`Repaired ${missing.length} interrupted tool result(s) for ticket ${ticketId}.`, `Ticket-${ticketId}`);
  }
  return missing.length > 0;
}

function reconstructWorkflowFlags(messages, sessionContext) {
  const wakeIndex = messages.reduce((lastIndex, message, index) => (
    message.role === 'user' && message.content?.includes('player has sent a new update') ? index : lastIndex
  ), -1);

  const toolCalls = new Map();
  sessionContext.unknownWordChecks ||= {};

  for (const message of messages.slice(wakeIndex + 1)) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        let args = {};
        try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
        toolCalls.set(call.id, { name: call.function?.name, args });
      }
      continue;
    }
    if (message.role !== 'tool' || !parseToolResult(message.content).ok) continue;
    const result = parseToolResult(message.content);
    const call = toolCalls.get(message.tool_call_id);
    const toolName = message.name || call?.name;
    const flag = FLAG_BY_TOOL[toolName];
    if (flag) sessionContext.flags[flag] = true;
    if (toolName === 'read_ticket') {
      sessionContext.hasAttachments = Array.isArray(result.output?.attachments)
        && result.output.attachments.length > 0;
    }

    if (toolName === 'query_slang_dictionary') {
      const key = normalizeUnknownWord(call?.args?.term);
      if (key) {
        sessionContext.unknownWordChecks[key] ||= { slangMiss: false, knowledgeMiss: false };
        sessionContext.unknownWordChecks[key].slangMiss = typeof result.output === 'string'
          && result.output.startsWith('No slang definition found');
      }
    } else if (toolName === 'search_knowledge_base') {
      const key = normalizeUnknownWord(call?.args?.query);
      if (key) {
        sessionContext.unknownWordChecks[key] ||= { slangMiss: false, knowledgeMiss: false };
        sessionContext.unknownWordChecks[key].knowledgeMiss = !hasExactKnowledgeMatch(result.output, call?.args?.query);
      }
    }
  }
}

function normalizeToolResult(result, toolName) {
  if (result && typeof result === 'object' && typeof result.ok === 'boolean') return result;
  return { ok: true, terminal: toolName === 'idle', output: result };
}

async function requestCompletion(url, body, options, providerName) {
  let lastError;
  for (let attempt = 0; attempt <= config.llmMaxRetries; attempt += 1) {
    try {
      return await axios.post(url, body, options);
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const retryable = !status || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt === config.llmMaxRetries) break;
      const retryAfterSeconds = Number.parseFloat(error.response?.headers?.['retry-after']);
      const delayMs = Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1000
        : config.llmRetryBaseDelayMs * (2 ** attempt) + Math.floor(Math.random() * 100);
      logger.warn(`${providerName} request failed; retrying in ${delayMs}ms (attempt ${attempt + 2}).`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}


/**
 * Loads conversation history and performs selective tail validation
 * to prune dangling tool calls from interrupted assistant turns.
 */
function loadOrCreateHistory(ticketId, workflowRevision = 0) {
  assertValidTicketId(ticketId);
  const historyPath = join(config.historyDir, `${ticketId}.json`);
  const historyDir = dirname(historyPath);
  
  if (!existsSync(historyDir)) {
    mkdirSync(historyDir, { recursive: true });
  }

  if (!existsSync(historyPath)) {
    // New conversation history
    const initialMessages = [
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: `A new ticket is assigned to you. ticket_id: "${ticketId}". Call read_ticket to read the details.` }
    ];
    writeJsonAtomic(historyPath, initialMessages);
    return initialMessages;
  }

  try {
    const raw = readFileSync(historyPath, 'utf8');
    const messages = JSON.parse(raw);
    const repaired = repairIncompleteToolBatch(messages, ticketId);
    const revisionMarker = `workflow_revision:${workflowRevision}`;
    const revisionAdded = workflowRevision > 0
      && !messages.some((message) => message.content?.includes(revisionMarker));
    if (revisionAdded) {
      messages.push({
        role: 'user',
        content: `The player has sent a new update (${revisionMarker}). Call read_ticket to read the new message and process this revision.`
      });
    }
    
    if (repaired || revisionAdded) {
      writeJsonAtomic(historyPath, messages);
    }
    
    return messages;
  } catch (err) {
    logger.error(`Failed to parse history JSON for ticket ${ticketId}, creating fresh history`, `Ticket-${ticketId}`, err);
    const initialMessages = [
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: `A new ticket is assigned to you. ticket_id: "${ticketId}". Call read_ticket to read the details.` }
    ];
    writeJsonAtomic(historyPath, initialMessages);
    return initialMessages;
  }
}

/**
 * Saves conversation history to disk.
 */
function saveHistory(ticketId, messages) {
  const historyPath = join(config.historyDir, `${ticketId}.json`);
  writeJsonAtomic(historyPath, messages);
}

/**
 * Core ReAct execution loop running inside a worker thread.
 */
export async function runAgentLoop(sessionContext) {
  const { ticketId } = sessionContext;
  logger.info(`Entering agent loop using ${config.llmProvider.toUpperCase()} provider`, `Ticket-${ticketId}`);
  
  const messages = loadOrCreateHistory(ticketId, sessionContext.workflowRevision || 0);
  reconstructWorkflowFlags(messages, sessionContext);
  const openAiTools = getOpenAITools();

  let loopActive = true;
  let exitStatus = 'completed';
  let lastKnownTokenCount = 0;

  while (loopActive) {
    if (parentPort) {
      parentPort.postMessage({
        type: 'agent_activity',
        ticketId,
        step: 'awaiting_llm_completion',
        tokenCount: lastKnownTokenCount,
        flags: sessionContext.flags
      });
    }

    // 1. Context Token Safety Valve check using exact usage stats from last response
    if (lastKnownTokenCount > config.contextTokenBudget) {
      logger.error(`Context token budget exceeded (${lastKnownTokenCount} > ${config.contextTokenBudget}). Escalating ticket.`, `Ticket-${ticketId}`);
      messages.push({
        role: 'system',
        content: `SYSTEM: Conversation halted. Context budget of ${config.contextTokenBudget} tokens exceeded.`
      });
      saveHistory(ticketId, messages);
      
      exitStatus = 'escalated';
      loopActive = false;
      break;
    }

    logger.debug(`Sending completion request (Previous total tokens: ${lastKnownTokenCount})`, `Ticket-${ticketId}`);

    // Resolve LLM Provider parameters (OpenAI vs Llama.cpp)
    let url;
    let headers = { 'Content-Type': 'application/json' };
    let modelName;
    let requestTimeout = config.openaiTimeoutMs;

    if (config.llmProvider === 'llamacpp') {
      const baseUrl = config.llamacppUrl.replace(/\/$/, '');
      url = `${baseUrl}/v1/chat/completions`;
      modelName = config.llamacppModel;
      requestTimeout = config.llamacppTimeoutMs;

      
      // If user supplied API key in .env for local proxy, pass it, otherwise ignore
      if (config.openaiApiKey) {
        headers['Authorization'] = `Bearer ${config.openaiApiKey}`;
      }
    } else {
      url = 'https://api.openai.com/v1/chat/completions';
      if (!config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is not configured in environment variables for the openai provider.');
      }
      headers['Authorization'] = `Bearer ${config.openaiApiKey}`;
      modelName = config.openaiModel;
    }

    const completionBody = {
      model: modelName,
      messages: messages,
      tools: openAiTools,
      tool_choice: 'auto'
    };
    if (config.llmTemperature !== null) {
      completionBody.temperature = config.llmTemperature;
    }

    let response;
    try {
      response = await requestCompletion(
        url,
        completionBody,
        {
          headers: headers,
          timeout: requestTimeout
        },
        config.llmProvider.toUpperCase()
      );
    } catch (apiErr) {
      const errorMsg = errorMessage(apiErr, 'Unknown LLM provider error');
      logger.error(`${config.llmProvider.toUpperCase()} API request failed`, `Ticket-${ticketId}`, apiErr);
      throw new Error(`${config.llmProvider.toUpperCase()} API error: ${errorMsg}`);
    }

    const choice = response.data?.choices?.[0];
    if (!choice) {
      throw new Error(`${config.llmProvider.toUpperCase()} returned an empty choices array.`);
    }

    // Update exact token usage
    const usage = response.data?.usage;
    if (usage) {
      lastKnownTokenCount = usage.total_tokens || (usage.prompt_tokens + usage.completion_tokens) || 0;
      logger.debug(`Tokens used in last API turn: ${lastKnownTokenCount}`, `Ticket-${ticketId}`);
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage);
    saveHistory(ticketId, messages);

    // If model returned text content
    if (assistantMessage.content) {
      logger.debug(`Assistant content: "${assistantMessage.content.slice(0, 100)}..."`, `Ticket-${ticketId}`);
    }

    // 2. Handle Tool Calls
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      logger.info(`Received ${assistantMessage.tool_calls.length} tool calls from assistant`, `Ticket-${ticketId}`);
      
      for (let toolIndex = 0; toolIndex < assistantMessage.tool_calls.length; toolIndex += 1) {
        let toolCall = assistantMessage.tool_calls[toolIndex];
        if (!toolCall || typeof toolCall !== 'object') {
          toolCall = {};
          assistantMessage.tool_calls[toolIndex] = toolCall;
        }
        const callId = toolCall?.id || `malformed-${Date.now()}`;
        const name = toolCall?.function?.name;
        const argsString = toolCall?.function?.arguments;
        if (!toolCall?.id || !name || typeof argsString !== 'string') {
          toolCall.id = callId;
          toolCall.type = 'function';
          toolCall.function = {
            name: name || 'unknown_tool',
            arguments: typeof argsString === 'string' ? argsString : '{}'
          };
          const malformedResult = {
            ok: false,
            terminal: false,
            error: { code: 'MALFORMED_TOOL_CALL', message: 'The model returned an incomplete tool call.', retryable: false }
          };
          messages.push({
            role: 'tool',
            tool_call_id: callId,
            name: name || 'unknown_tool',
            content: JSON.stringify(malformedResult)
          });
          saveHistory(ticketId, messages);
          continue;
        }
        let args;
        try {
          args = JSON.parse(argsString);
        } catch (e) {
          logger.warn(`Failed to parse arguments for tool ${name}: ${argsString}`, `Ticket-${ticketId}`);
          const invalidResult = {
            ok: false,
            terminal: false,
            error: { code: 'INVALID_ARGUMENTS_JSON', message: 'Tool arguments were not valid JSON.', retryable: false }
          };
          messages.push({
            role: 'tool', tool_call_id: toolCall.id, name, content: JSON.stringify(invalidResult)
          });
          saveHistory(ticketId, messages);
          continue;
        }

        if (parentPort) {
          parentPort.postMessage({
            type: 'agent_activity',
            ticketId,
            step: `executing_tool:${name}`,
            toolName: name,
            toolArgs: args,
            tokenCount: lastKnownTokenCount,
            flags: sessionContext.flags
          });
        }

        logger.info(`Executing tool "${name}"`, `Ticket-${ticketId}`);
        
        let toolResult;
        try {
          toolResult = normalizeToolResult(await executeTool(name, args, sessionContext), name);
        } catch (toolExecErr) {
          logger.error(`Error executing tool "${name}"`, `Ticket-${ticketId}`, toolExecErr);
          toolResult = {
            ok: false,
            terminal: false,
            error: { code: 'TOOL_BROKER_FAILED', message: toolExecErr.message, retryable: false }
          };
        }

        // Add tool response message
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: name,
          content: JSON.stringify(toolResult)
        });
        saveHistory(ticketId, messages);

        // Check if the loop has terminated successfully via the idle tool check
        if (name === 'idle' && toolResult.ok && toolResult.terminal !== false) {
          logger.info(`Idle tool execution validated. Exiting agent loop.`, `Ticket-${ticketId}`);
          loopActive = false;
          
          // Determine final status based on resolution outcome
          if (sessionContext.resolutionType === 'escalated') {
            exitStatus = 'escalated';
          } else {
            exitStatus = 'completed';
          }
          break;
        }

      }
    } else {
      // If the model did not call any tools, it is in violation of system prompt instructions
      logger.warn(`Assistant did not generate any tool calls. Forcing tool call reminder.`, `Ticket-${ticketId}`);
      messages.push({
        role: 'user',
        content: 'Reminder: You must communicate exclusively through tool calls. If you are finished, you must call the "idle" tool. Otherwise, proceed with the required ticket processing tools.'
      });
      saveHistory(ticketId, messages);
    }
  }

  const finalized = finalizeTicket(
    ticketId,
    exitStatus,
    sessionContext.resolutionType || (exitStatus === 'escalated' ? 'escalated' : null),
    sessionContext.resolutionReason || (exitStatus === 'escalated' ? 'Context token limit reached' : null),
    { draftResponseMode: config.draftResponseMode }
  );

  if (
    sessionContext.deleteAfterResolution
    && finalized.finalized
    && finalized.status === 'completed'
    && sessionContext.resolutionType === 'resolved'
  ) {
    try {
      const deletion = deleteResolvedTicket(ticketId);
      return { status: 'deleted', finalized: true, deletion };
    } catch (error) {
      logger.error(`Ticket ${ticketId} was resolved but deferred deletion failed`, `Ticket-${ticketId}`, error);
    }
  }

  return { status: finalized.status, finalized: finalized.finalized };
}
