// src/agent/loop.js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { updateTicketStatus } from '../database/sqlite.js';
import { executeTool, getOpenAITools } from './registry.js';

/**
 * Loads conversation history and performs selective tail validation
 * to prune dangling tool calls from interrupted assistant turns.
 */
function loadOrCreateHistory(ticketId) {
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
    writeFileSync(historyPath, JSON.stringify(initialMessages, null, 2));
    return initialMessages;
  }

  try {
    const raw = readFileSync(historyPath, 'utf8');
    const messages = JSON.parse(raw);
    
    // Selective Tail Validation
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      
      // If the last message is from assistant requesting tool calls, but there is no subsequent
      // tool response message, the worker must have crashed mid-turn.
      if (lastMsg.role === 'assistant' && lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
        logger.warn(`Detected incomplete assistant turn in history for ticket ${ticketId}. Truncating tail message.`, `Ticket-${ticketId}`);
        messages.pop(); // Remove the dangling assistant turn
        writeFileSync(historyPath, JSON.stringify(messages, null, 2));
      }
    }
    
    return messages;
  } catch (err) {
    logger.error(`Failed to parse history JSON for ticket ${ticketId}, creating fresh history`, `Ticket-${ticketId}`, err);
    const initialMessages = [
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: `A new ticket is assigned to you. ticket_id: "${ticketId}". Call read_ticket to read the details.` }
    ];
    writeFileSync(historyPath, JSON.stringify(initialMessages, null, 2));
    return initialMessages;
  }
}

/**
 * Saves conversation history to disk.
 */
function saveHistory(ticketId, messages) {
  const historyPath = join(config.historyDir, `${ticketId}.json`);
  writeFileSync(historyPath, JSON.stringify(messages, null, 2));
}

/**
 * Core ReAct execution loop running inside a worker thread.
 */
export async function runAgentLoop(sessionContext) {
  const { ticketId } = sessionContext;
  logger.info(`Entering agent loop using ${config.llmProvider.toUpperCase()} provider`, `Ticket-${ticketId}`);
  
  const messages = loadOrCreateHistory(ticketId);
  const openAiTools = getOpenAITools();

  let loopActive = true;
  let exitStatus = 'completed';
  let lastKnownTokenCount = 0;

  while (loopActive) {
    // 1. Context Token Safety Valve check using exact usage stats from last response
    if (lastKnownTokenCount > config.contextTokenBudget) {
      logger.error(`Context token budget exceeded (${lastKnownTokenCount} > ${config.contextTokenBudget}). Escalating ticket.`, `Ticket-${ticketId}`);
      updateTicketStatus(ticketId, 'escalated', 'Context token limit reached');
      
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

    let response;
    try {
      response = await axios.post(
        url,
        {
          model: modelName,
          messages: messages,
          tools: openAiTools,
          tool_choice: 'auto'
        },
        {
          headers: headers,
          timeout: requestTimeout
        }
      );
    } catch (apiErr) {
      const errorMsg = apiErr.response?.data?.error?.message || apiErr.message || String(apiErr);
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
      
      for (const toolCall of assistantMessage.tool_calls) {
        const { name, arguments: argsString } = toolCall.function;
        let args = {};
        try {
          args = JSON.parse(argsString);
        } catch (e) {
          logger.warn(`Failed to parse arguments for tool ${name}: ${argsString}`, `Ticket-${ticketId}`);
        }

        logger.info(`Executing tool "${name}"`, `Ticket-${ticketId}`);
        
        let toolOutput;
        try {
          toolOutput = await executeTool(name, args, sessionContext);
        } catch (toolExecErr) {
          logger.error(`Error executing tool "${name}"`, `Ticket-${ticketId}`, toolExecErr);
          toolOutput = `Error: Tool execution failed: ${toolExecErr.message}`;
        }

        // Add tool response message
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: name,
          content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput)
        });
        saveHistory(ticketId, messages);

        // Check if the loop has terminated successfully via the idle tool check
        if (name === 'idle' && !toolOutput.includes('Validation failed')) {
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

  // Update ticket final status in SQLite
  updateTicketStatus(ticketId, exitStatus);
  return { status: exitStatus };
}
