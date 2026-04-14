# Finance — WhatsApp Personal Finance Bot

A personal finance tracker that lets you log expenses and income by simply sending messages on WhatsApp. Powered by Claude AI for natural language parsing.

## How it works

1. Send a WhatsApp message like *"spent 150 on lunch"* or *"income 5000 salary"*
2. The bot parses the message using Claude AI and saves the transaction
3. Ask for summaries: *"how much did I spend this week?"*
4. Get automatic alerts when you exceed category limits or have unusual expenses

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 20+ · pnpm workspaces |
| Backend | Fastify 5 · TypeScript · Prisma |
| Frontend | Next.js 15 · React |
| Database | PostgreSQL (Supabase) |
| AI | Claude (Anthropic) |
| WhatsApp | whatsapp-web.js |
| Deploy | Render |

## Project structure

```
Finance/
├── apps/
│   ├── backend/          # Fastify API + WhatsApp client
│   │   ├── src/
│   │   │   ├── routes/   # REST endpoints
│   │   │   ├── services/ # Business logic
│   │   │   ├── lib/      # Prisma, logger, env
│   │   │   └── wa/       # WhatsApp client
│   │   └── prisma/       # DB schema & migrations
│   └── web/              # Next.js dashboard
├── packages/
│   └── shared/           # Types, schemas, prompts shared across apps
├── render.yaml           # Render deploy config
└── pnpm-workspace.yaml
```

## Local setup

### Prerequisites

- Node.js >= 20
- pnpm >= 10
- PostgreSQL database (or Supabase free tier)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp apps/backend/.env.example apps/backend/.env
```

Edit `apps/backend/.env`:

```env
DATABASE_URL=postgresql://user:password@host:5432/finance
ANTHROPIC_API_KEY=sk-ant-...
SESSION_SECRET=your-random-secret
INTERNAL_API_TOKEN=your-internal-token
APP_URL=http://localhost:3001
PORT=3001
NODE_ENV=development
WA_AUTH_STRATEGY=local
```

### 3. Set up the database

```bash
pnpm db:migrate
```

### 4. Run in development

```bash
# Backend (API + WhatsApp bot)
pnpm dev:backend

# Frontend dashboard
pnpm dev:web
```

On first run, scan the QR code printed in the terminal with your WhatsApp to authenticate the bot.

## Deploy to Render

The `render.yaml` file configures both services. Set the following environment variables in the Render dashboard (marked `sync: false`):

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `APP_URL` | Public URL of the backend service |

## Available scripts

```bash
pnpm dev:backend      # Start backend in watch mode
pnpm dev:web          # Start Next.js dev server
pnpm build            # Build all packages
pnpm db:generate      # Regenerate Prisma client
pnpm db:migrate       # Run DB migrations
pnpm db:push          # Push schema without migration file
```

## Alert types

| Alert | Description |
|---|---|
| `category_limit` | Notifies when spending in a category exceeds a threshold |
| `negative_balance` | Fires when total balance goes negative |
| `unusual_expense` | Detects abnormally large transactions |
| `weekly_summary` | Sends a spending summary on a chosen day |
