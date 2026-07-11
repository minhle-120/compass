// src/agent/registry.js
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const toolsDir = join(__dirname, '../tools');

// Map containing all tool schemas and implementation handlers
const registry = {};

function register(name, schema, handler) {
  registry[name] = { schema, handler };
}

// Dynamically load and register tools in the tools directory (Plugin System)
try {
  const files = readdirSync(toolsDir);
  for (const file of files) {
    // Exclude test files, dotfiles, and directories
    if (file.endsWith('.js') && !file.includes('.test.js')) {
      const filePath = join(toolsDir, file);
      
      // Dynamic import in ESM
      const module = await import(`file://${filePath}`);
      
      // Ensure the tool has both a schema and a handler
      if (module.schema && module.handler) {
        const toolName = module.schema.function?.name || file.replace('.js', '');
        register(toolName, module.schema, module.handler);
        logger.debug(`Automatically registered tool: "${toolName}" from ${file}`);
      } else {
        logger.warn(`Skipped loading ${file}: missing schema or handler exports`);
      }
    }
  }
  logger.info(`Auto-registry initialized. Loaded ${Object.keys(registry).length} tools.`);
} catch (err) {
  logger.error('Failed to auto-register tools in registry', 'ToolRegistry', err);
}

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

  // Track checklist progress depending on what tool was called
  if (name === 'read_ticket') {
    sessionContext.flags.wasTicketRead = true;
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

  // Intercept the idle tool to perform the Local In-Worker Validation Check
  if (name === 'idle') {
    const resolutionType = args.resolution_type;
    const missing = [];

    // All outcomes require the ticket to be read first
    if (!sessionContext.flags.wasTicketRead) {
      missing.push('read_ticket');
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
      return errorMsg;
    }
  }


  // Execute the tool handler
  try {
    const result = await tool.handler(args, sessionContext);
    return result;
  } catch (err) {
    logger.error(`Error in tool execution handler for "${name}"`, `Ticket-${ticketId}`, err);
    throw err;
  }
}
