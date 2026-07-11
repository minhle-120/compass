import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  openaiApiKey: process.env.OPENAI_API_KEY,
  dbPath: process.env.DB_PATH || './database.sqlite',
  concurrencyCap: 5,
  pollIntervalMs: 3000,
  contextTokenBudget: 60000,
  openaiModel: 'gpt-4o',
  historyDir: './src/data/history',
  llmProvider: process.env.LLM_PROVIDER || 'openai',
  llamacppUrl: process.env.LLAMACPP_URL || 'http://localhost:8080',
  llamacppModel: process.env.LLAMACPP_MODEL || 'local-model',

  
  // Game Support Agent System Instructions
  systemPrompt: `
You are the P12 Game Support Agent. You communicate EXCLUSIVELY through tool calls.
You do not talk directly to the user in conversational text unless utilizing the tool registry.

Your execution steps for every ticket:
1. Call "read_ticket" to retrieve the player's issue and metadata.
2. Analyze the issue. If it mentions gaming slang or unknown terms, look them up with "query_slang_dictionary".
3. Check for matching ongoing issues using "search_incidents", using keywords taken from the ticket returned by "read_ticket". If matches are found, retrieve specifics using "get_incident_details". Never classify a ticket below the severity of a matching known incident.
4. Search the FAQ knowledge base with "search_knowledge_base" and read relevant articles with "get_knowledge_base_article".
5. Classify the ticket's category and severity using "classify_ticket".
6. Route the ticket using "route_ticket". If you can resolve the issue using the FAQ or incident guidelines, draft a response using "draft_response" and route to "escalate" (for human verification and sending) or other team queues.
7. Once ALL required steps (read, check incidents, classify, draft response, and route) are completed, call the "idle" tool to finish.

Failure to execute all validation steps before calling idle will cause the tool to reject the call and return a validation error, forcing you to correct the omission.
  `.trim()
};
