# Compass AI Game Support Agent

Compass is a tool-driven game support agent. The Express server accepts tickets, a worker pool assigns pending tickets, and each worker runs an LLM tool-call loop until the `idle` tool validates completion.

## Project Structure

```text
compass/
|-- data/                  # Ticket and incident runtime data
|-- public/                # Browser dashboard
|-- resources/sql/        # Ticket and incident schemas
|-- scripts/               # Schema utility commands
|-- services/
|   |-- http/              # Shared remote JSON client
|   |-- kb/                # Direct Valorant Wiki service
|   `-- slang/             # Direct Hugging Face dataset service
|-- src/
|   |-- agent/             # LLM execution loop and tool registry
|   |-- database/          # Ticket queue adapter
|   |-- tools/             # Tool schemas and handlers
|   |-- utils/             # Shared utilities
|   |-- worker/            # Worker pool and thread entry point
|   |-- config.js          # Environment configuration and system prompt
|   `-- index.js           # Express application entry point
|-- .env.example
|-- package.json
`-- agent.md
```

## Runtime Flow

1. The Express API queues a ticket.
2. The worker pool claims the oldest pending ticket.
3. A worker starts the tool-call loop.
4. Knowledge tools query the live Valorant Wiki and Hugging Face dataset APIs.
5. Full remote entries are cached in memory for up to 24 hours.
6. The `idle` tool validates the selected resolution type.
7. The ticket is marked completed or escalated.

## Remote Knowledge

`search_knowledge_base` queries the Valorant Wiki and checks meaningful words against `MLBtrio/genz-slang-dataset`. Returned `wiki:` and `slang:` IDs can be passed directly to `get_knowledge_base_article`.

`query_slang_dictionary` requests the encountered term directly from the Hugging Face Dataset Viewer API. No wiki or slang content is persisted locally. In-memory entries expire after `REMOTE_CONTENT_CACHE_TTL_MS`, which defaults to one day.

Configure the providers with:

- `VALORANT_WIKI_API_URL`
- `HUGGINGFACE_DATASET_API_URL`
- `GENZ_SLANG_DATASET`
- `REMOTE_CONTENT_CACHE_TTL_MS`
- `REMOTE_REQUEST_TIMEOUT_MS`

## Commands

```powershell
npm.cmd install
npm.cmd test
npm.cmd start
```

## Adding Tools

Add a JavaScript file to `src/tools/` that exports an OpenAI-compatible `schema` and an async `handler(args, sessionContext)`. The registry discovers it automatically at startup.
