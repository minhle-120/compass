# Compass AI Game Support Agent

Compass is a tool-driven game support agent. The Express server accepts tickets, a worker pool assigns pending tickets, and each worker runs an LLM tool-call loop until the `idle` tool validates completion.

## Project Structure

```text
compass/
|-- data/                  # Generated SQLite databases (gitignored)
|-- public/                # Browser dashboard
|-- resources/
|   |-- source/            # Original import source files
|   `-- sql/               # Database schemas and seed data
|-- scripts/               # Database initialization and sync commands
|-- src/
|   |-- agent/             # LLM execution loop and tool registry
|   |-- database/          # SQLite adapters and knowledge cache
|   |-- services/          # Background synchronization services
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

1. The Express API stores a new ticket in `data/database.sqlite`.
2. The Valorant Wiki service refreshes the local knowledge cache when stale.
3. The worker pool claims the oldest pending ticket.
4. A worker starts the tool-call loop for that ticket.
5. Tools read ticket, incident, wiki, terminology, and slang data.
6. The `idle` tool validates the selected resolution type.
7. The ticket is marked completed or escalated.

## Knowledge Base

`src/services/valorantWikiSync.js` imports main-namespace pages from the Valorant Wiki into `kb_articles`. The first run performs a full import. Later runs use MediaWiki recent changes and refresh only new or edited pages.

The application checks the cache at startup and schedules another check every 24 hours. Configure this behavior with:

- `VALORANT_WIKI_API_URL`
- `VALORANT_WIKI_SYNC_ENABLED`
- `VALORANT_WIKI_SYNC_INTERVAL_MS`
- `VALORANT_WIKI_REQUEST_TIMEOUT_MS`
- `VALORANT_WIKI_BATCH_SIZE`

Run an immediate incremental refresh with:

```powershell
node scripts/sync-valorant-wiki.js
```

Force a complete reimport with:

```powershell
node scripts/sync-valorant-wiki.js --full
```

## Database Files

- `data/database.sqlite`: ticket queue and cached knowledge-base articles.
- `data/Game Knowledge Base.sqlite`: local Valorant terminology and game mechanics.
- `data/slang.sqlite`: imported Gen-Z slang dataset.
- `data/tickets.sqlite`: standalone ticket records.
- `data/incidents.sqlite`: standalone incident records.

## Commands

```powershell
npm.cmd install
npm.cmd run db:init
npm.cmd run db:init:slang
npm.cmd run db:init:tickets
npm.cmd run db:init:incidents
npm.cmd start
```

## Adding Tools

Add a JavaScript file to `src/tools/` that exports an OpenAI-compatible `schema` and an async `handler(args, sessionContext)`. The registry discovers it automatically at startup.
