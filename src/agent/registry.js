// src/agent/registry.js
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { logger } from '../utils/logger.js';
import { hasExactKnowledgeMatch, normalizeUnknownWord } from '../utils/unknownWord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const toolsDir = join(__dirname, '../tools');

// Map containing all tool schemas and implementation handlers
const registry = {};

function register(name, schema, handler) {
  registry[name] = { schema, handler };
}

// Dynamically load and register tools in the tools directory (Plugin System).
// Startup fails if any tool is malformed so workers never run with a partial registry.
const files = readdirSync(toolsDir)
  .filter((file) => file.endsWith('.js') && !file.includes('.test.js'))
  .sort();

for (const file of files) {
  const filePath = join(toolsDir, file);
  const module = await import(pathToFileURL(filePath).href);
  const toolName = module.schema?.function?.name;

  if (!toolName || typeof module.handler !== 'function') {
    throw new Error(`Invalid tool module "${file}": schema.function.name and handler are required.`);
  }
  if (registry[toolName]) {
    throw new Error(`Duplicate tool name "${toolName}" in "${file}".`);
  }

  register(toolName, module.schema, module.handler);
  logger.debug(`Automatically registered tool: "${toolName}" from ${file}`);
}
logger.info(`Auto-registry initialized. Loaded ${Object.keys(registry).length} tools.`);

/**
 * Returns an array of tool definitions formatted for the OpenAI-compatible Chat Completions API.
 */
export function getOpenAITools() {
  return Object.values(registry).map(item => item.schema);
}

/**
 * Routes tool call to the registered handler, tracks session context flags, 
 * and performs checklist validation checks.
 */
export async function executeTool(name, args, sessionContext) {
  const tool = registry[name];
  if (!tool) {
    throw new Error(`Tool "${name}" is not registered in the tool broker.`);
  }

  const { ticketId } = sessionContext;
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return {
      ok: false,
      terminal: false,
      error: { code: 'INVALID_ARGUMENT', message: 'Tool arguments must be a JSON object.', retryable: false }
    };
  }

  if (name === 'flag_unknown_word') {
    const key = normalizeUnknownWord(args.word);
    const evidence = sessionContext.unknownWordChecks?.[key];
    const missing = [];
    if (!evidence?.slangMiss) missing.push('query_slang_dictionary with the exact word');
    if (!evidence?.knowledgeMiss) missing.push('search_knowledge_base with the exact word');
    if (missing.length) {
      return {
        ok: false,
        terminal: false,
        error: {
          code: 'LOOKUP_REQUIRED',
          message: `Cannot flag "${args.word || ''}" until these no-result checks succeed: ${missing.join(', ')}.`,
          retryable: false
        },
        missingSteps: missing
      };
    }
  }

  // Intercept the idle tool to perform the Local In-Worker Validation Check
  if (name === 'idle') {
    const resolutionType = args.resolution_type;
    const missing = [];

    // All outcomes require the ticket to be read first
    if (!sessionContext.flags.wasTicketRead) {
      missing.push('read_ticket');
    }
    if (sessionContext.hasAttachments && !sessionContext.flags.wasAttachmentsInspected) {
      missing.push('inspect_ticket_attachments');
    }

    if (resolutionType === 'resolved') {
      if (!sessionContext.flags.wasIncidentsChecked) missing.push('search_incidents or get_incident_details');
      if (!sessionContext.flags.wasKnowledgeBaseChecked) missing.push('search_knowledge_base or get_knowledge_base_article');
      if (!sessionContext.flags.wasClassified) missing.push('classify_ticket');
      if (!sessionContext.flags.wasResponseDrafted) missing.push('draft_response');
      if (!sessionContext.flags.wasRouted) missing.push('route_ticket');
    } else if (resolutionType === 'needs_clarification') {
      if (!sessionContext.flags.wasResponseDrafted) missing.push('draft_response');
    } else if (resolutionType === 'escalated') {

      if (!sessionContext.flags.wasIncidentsChecked) missing.push('search_incidents or get_incident_details');
      if (!sessionContext.flags.wasClassified) missing.push('classify_ticket');
      if (!sessionContext.flags.wasRouted) missing.push('route_ticket');
    } else if (resolutionType === 'rejected') {
      // Rejections (spam/invalid) only require read_ticket
    } else {
      missing.push('valid resolution_type (resolved, needs_clarification, escalated, or rejected)');
    }

    if (missing.length > 0) {
      const errorMsg = `Validation failed! For resolution_type "${resolutionType}", you are missing required steps: ${missing.join(', ')}.`;
      logger.warn(errorMsg, `Ticket-${ticketId}`);
      return {
        ok: false,
        terminal: false,
        error: { code: 'WORKFLOW_INCOMPLETE', message: errorMsg, retryable: false },
        missingSteps: missing
      };
    }
  }

  try {
    const result = await tool.handler(args, sessionContext);
    if (name === 'query_slang_dictionary') {
      const key = normalizeUnknownWord(args.term);
      const checks = getUnknownWordChecks(sessionContext, key);
      checks.slangMiss = typeof result === 'string' && result.startsWith('No slang definition found');
    } else if (name === 'search_knowledge_base') {
      const key = normalizeUnknownWord(args.query);
      const checks = getUnknownWordChecks(sessionContext, key);
      checks.knowledgeMiss = !hasExactKnowledgeMatch(result, args.query);
    }
    if (name === 'read_ticket') {
      sessionContext.flags.wasTicketRead = true;
      sessionContext.hasAttachments = Array.isArray(result.attachments) && result.attachments.length > 0;
    } else if (name === 'inspect_ticket_attachments') {
      sessionContext.flags.wasAttachmentsInspected = true;
    } else if (name === 'classify_ticket') {
      sessionContext.flags.wasClassified = true;
    } else if (name === 'draft_response') {
      sessionContext.flags.wasResponseDrafted = true;
    } else if (name === 'search_incidents' || name === 'get_incident_details') {
      sessionContext.flags.wasIncidentsChecked = true;
    } else if (name === 'search_knowledge_base' || name === 'get_knowledge_base_article') {
      sessionContext.flags.wasKnowledgeBaseChecked = true;
    } else if (name === 'route_ticket') {
      sessionContext.flags.wasRouted = true;
      sessionContext.routingDestination = args.destination;
    }

    return { ok: true, terminal: name === 'idle', output: result };
  } catch (err) {
    logger.error(`Error in tool execution handler for "${name}"`, `Ticket-${ticketId}`, err);
    return {
      ok: false,
      terminal: false,
      error: {
        code: err.code || (err instanceof TypeError ? 'INVALID_ARGUMENT' : 'TOOL_EXECUTION_FAILED'),
        message: err.message || String(err),
        retryable: Boolean(err.retryable)
      }
    };
  }
}

function getUnknownWordChecks(sessionContext, key) {
  sessionContext.unknownWordChecks ||= {};
  sessionContext.unknownWordChecks[key] ||= { slangMiss: false, knowledgeMiss: false };
  return sessionContext.unknownWordChecks[key];
}
