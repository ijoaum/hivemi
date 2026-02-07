# HiveMI Quick Start

Get your AI agent swarm running in 5 minutes.

## Prerequisites

- **Node.js 22+** — [Download](https://nodejs.org/)
- **pnpm 9+** — `npm install -g pnpm`
- **Docker** — For PostgreSQL

## 1. Clone & Install

```bash
git clone https://github.com/ijoaum/hivemi.git
cd hivemi
pnpm install
```

## 2. Start Database

```bash
docker-compose up -d postgres
```

Wait a few seconds for PostgreSQL to start, then create the tables:

```bash
# Connect and run migrations
docker exec -i hivemi-postgres psql -U hivemi -d hivemi < scripts/init.sql
```

Or use the Drizzle CLI:

```bash
pnpm db:migrate
```

## 3. Start Services

Open three terminals:

**Terminal 1 - Registry (Database API)**
```bash
pnpm dev:registry
# Starts on http://localhost:4001
```

**Terminal 2 - Manager (External Interface)**
```bash
pnpm dev:manager
# Starts on http://localhost:4000
```

**Terminal 3 - Dashboard (Web UI)**
```bash
pnpm dev:dashboard
# Starts on http://localhost:3000
```

## 4. Open the Dashboard

Visit [http://localhost:3000](http://localhost:3000) in your browser.

You should see:
- The Hive dashboard with team containers
- Status bar showing agents (initially empty)
- Navigation sidebar

## 5. Create Your First Task

Using the CLI:

```bash
# First, get your team ID
pnpm cli teams list

# Create a task
pnpm cli tasks create "Build a login page" --team <team-id> --priority high

# Check task status
pnpm cli tasks list
```

Or use the Dashboard:
1. Click the **Tasks** link in the sidebar
2. (Coming soon: Create Task button)

## 6. Start an Agent (Optional)

To process tasks, you need agents running:

```bash
# Set environment variables
export REGISTRY_URL=http://localhost:4001
export OPENAI_API_KEY=sk-your-key

# Start the PM agent
cd agents/pm && pnpm dev
```

The agent will:
1. Register itself with the Registry
2. Start sending heartbeats
3. Pick up queued tasks automatically

## Environment Variables

Create a `.env` file in the root:

```bash
# Database
DATABASE_URL=postgresql://hivemi:hivemi@localhost:5432/hivemi

# LLM Providers (at least one required for agents)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Optional: Shared secret for auth
HIVEMI_SECRET=your-secret-here
```

## Next Steps

- 📖 Read the [Architecture Guide](./ARCHITECTURE.md)
- 🎭 Learn about [Roles](./ROLES.md)
- 🔌 Check the [API Reference](./API.md)
- 🤖 Create [Custom Agents](./AGENTS.md)

## Troubleshooting

### "Connection refused" errors

Make sure PostgreSQL is running:
```bash
docker ps | grep hivemi-postgres
```

If not running:
```bash
docker-compose up -d postgres
```

### "Relation does not exist" errors

Run migrations:
```bash
pnpm db:migrate
```

### Agents not picking up tasks

1. Check if agents are registered: `pnpm cli agents list`
2. Verify agent is idle (not offline)
3. Check logs in the Dashboard

### Dashboard shows mock data

The dashboard falls back to mock data if the API is unreachable. Make sure Registry and Manager are running.
