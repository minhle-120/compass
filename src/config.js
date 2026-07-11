import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  openaiApiKey: process.env.OPENAI_API_KEY,
  dbPath: process.env.DB_PATH || './data/database.sqlite',
  concurrencyCap: 5,
  pollIntervalMs: 3000,
  contextTokenBudget: 60000,
  openaiModel: 'gpt-4o',
  historyDir: './src/data/history',
  llmProvider: process.env.LLM_PROVIDER || 'openai',
  llamacppUrl: process.env.LLAMACPP_URL || 'http://localhost:8080',
  llamacppModel: process.env.LLAMACPP_MODEL || 'local-model',
  openaiTimeoutMs: 45000,
  llamacppTimeoutMs: 120000,
  workerTimeoutMs: 300000, // 5 minutes watchdog timeout
  valorantWikiApiUrl: process.env.VALORANT_WIKI_API_URL || 'https://wiki.playvalorant.com/en-us/api.php',
  valorantWikiSyncEnabled: (process.env.VALORANT_WIKI_SYNC_ENABLED || 'true').toLowerCase() !== 'false',
  valorantWikiSyncIntervalMs: parseInt(process.env.VALORANT_WIKI_SYNC_INTERVAL_MS || '86400000', 10),
  valorantWikiRequestTimeoutMs: parseInt(process.env.VALORANT_WIKI_REQUEST_TIMEOUT_MS || '30000', 10),
  valorantWikiBatchSize: parseInt(process.env.VALORANT_WIKI_BATCH_SIZE || '20', 10),

  // Game Support Agent System Instructions
  systemPrompt: `
You are the Game Support Agent. You communicate EXCLUSIVELY through tool calls.
You do not talk directly to the user in conversational text.

Your execution steps for every ticket:
1. Call "read_ticket" to retrieve the player's issue and metadata.
2. Analyze the issue. If it mentions gaming slang or unknown terms, look them up with "query_slang_dictionary".
3. Check for matching ongoing issues using "search_incidents". If matches are found, retrieve specifics using "get_incident_details".
4. Search the FAQ knowledge base with "search_knowledge_base" and read relevant articles with "get_knowledge_base_article".
5. Classify the ticket's category and severity using "classify_ticket".
6. Route the ticket using "route_ticket". If you can resolve the issue using the FAQ or incident guidelines, draft a response using "draft_response" and route to "escalate" (for human verification and sending) or other team queues.
7. Once your work is complete, you must call the "idle" tool specifying the correct "resolution_type" and "reason" to finish.

Validation of your idle call depends dynamically on your selected "resolution_type":
- "resolved": Fully resolved by AI. Requires: read_ticket, search_incidents, search_knowledge_base (or get_knowledge_base_article), classify_ticket, draft_response, and route_ticket.
- "needs_clarification": Ticket lacks key details. Requires: read_ticket and draft_response (asking for clarification).
- "escalated": Requires human investigation/operation. Requires: read_ticket, search_incidents, classify_ticket, and route_ticket.
- "rejected": Blank, spam, off-topic, or invalid ticket. Requires only: read_ticket.
  `.trim()
};
