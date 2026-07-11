import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Server & Queue Database Configuration
  port: parseInt(process.env.PORT || '3000', 10),
  get dbPath() {
    return process.env.DB_PATH || './data/database.sqlite';
  },
  get wikiDbPath() {
    return process.env.WIKI_DB_PATH || './data/wiki.sqlite';
  },

  concurrencyCap: 5,
  pollIntervalMs: 3000,

  // Storage Paths
  historyDir: './src/data/history',

  // LLM Orchestration Settings
  llmProvider: process.env.LLM_PROVIDER || 'openai',
  contextTokenBudget: 60000,

  // OpenAI Cloud API Configuration
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: 'gpt-4o',
  openaiTimeoutMs: 45000,

  // Llama.cpp Local API Configuration
  llamacppUrl: process.env.LLAMACPP_URL || 'http://localhost:8080',
  llamacppModel: process.env.LLAMACPP_MODEL || 'local-model',
  llamacppTimeoutMs: 120000,

  // Worker Thread Watchdogs & Safety Budgets
  workerTimeoutMs: 300000, // 5-minute execution watchdog timeout

  // Local wiki source import and direct slang provider
  valorantWikiApiUrl: process.env.VALORANT_WIKI_API_URL || 'https://wiki.playvalorant.com/en-us/api.php',
  valorantApiUrl: process.env.VALORANT_API_URL || 'https://valorant-api.com',
  valorantWikiTerminologyPage: process.env.VALORANT_WIKI_TERMINOLOGY_PAGE || 'Terminology',
  wikiSyncIntervalMs: parseInt(process.env.WIKI_SYNC_INTERVAL_MS || '86400000', 10),
  huggingFaceDatasetApiUrl: process.env.HUGGINGFACE_DATASET_API_URL || 'https://datasets-server.huggingface.co',
  genzSlangDataset: process.env.GENZ_SLANG_DATASET || 'MLBtrio/genz-slang-dataset',
  remoteContentCacheTtlMs: parseInt(process.env.REMOTE_CONTENT_CACHE_TTL_MS || '86400000', 10),
  remoteRequestTimeoutMs: parseInt(process.env.REMOTE_REQUEST_TIMEOUT_MS || '30000', 10),

  // Game Support Agent System Instructions
  systemPrompt: `
You are the Game Support Agent. You communicate EXCLUSIVELY through tool calls.
You do not talk directly to the user in conversational text.

Your execution steps for every ticket:
1. Call "read_ticket" to retrieve the player's issue and metadata.
2. Analyze the issue. If it mentions slang or unknown terms, call "query_slang_dictionary" to retrieve the current definition directly from the Gen-Z slang dataset.
3. Check for matching ongoing issues using "search_incidents". If matches are found, retrieve specifics using "get_incident_details".
4. Search the local Compass Wiki with "search_knowledge_base" and read relevant entries with "get_knowledge_base_article".
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
