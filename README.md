# 🐝 HiveMI - Hive Mesh Intelligence

An AI agent orchestration platform where agents work like a dev squad.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        HiveMI Cluster                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐     HTTP      ┌──────────────┐                    │
│  │ Dashboard ├──────────────►│   Manager    │◄── External Tasks │
│  │  :3000   │               │    :4000     │                    │
│  └──────────┘               └──────┬───────┘                    │
│                                    │                             │
│                                    ▼                             │
│                           ┌────────────────┐                     │
│                           │    Registry    │                     │
│                           │     :4001      │                     │
│                           │   PostgreSQL   │                     │
│                           └────────┬───────┘                     │
│                                    │                             │
│              ┌─────────────────────┼─────────────────────┐       │
│              │                     │                     │       │
│              ▼                     ▼                     ▼       │
│      ┌─────────────┐       ┌─────────────┐       ┌───────────┐  │
│      │  PM Agent   │◄─────►│ Tech Lead   │◄─────►│ Developer │  │
│      │   :3002     │  P2P  │   :3003     │  P2P  │   :3001   │  │
│      └─────────────┘       └─────────────┘       └───────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker (for PostgreSQL)

### Setup

```bash
# Clone and install
git clone https://github.com/ijoaum/hivemi.git
cd hivemi
pnpm install

# Start PostgreSQL
docker-compose up -d postgres

# Run migrations
cd apps/registry && pnpm db:migrate

# Start services (in separate terminals)
pnpm --filter @hivemi/registry dev    # Registry on :4001
pnpm --filter @hivemi/manager dev     # Manager on :4000
pnpm --filter dashboard dev           # Dashboard on :3000
```

### Using the CLI

```bash
# Check cluster status
pnpm --filter @hivemi/cli dev status

# List agents
pnpm --filter @hivemi/cli dev agents list

# Create a task
pnpm --filter @hivemi/cli dev tasks create "Build login page" --team <team-id> --priority high

# List tasks
pnpm --filter @hivemi/cli dev tasks list
```

## Project Structure

```
hivemi/
├── apps/
│   ├── dashboard/        # Next.js 15 + React 19 + Tremor
│   ├── registry/         # Hono API + Drizzle + PostgreSQL
│   └── manager/          # Hono API (external interface)
├── packages/
│   ├── protocol/         # Shared types + Zod schemas
│   ├── agent-runtime/    # Base agent framework
│   ├── llm/              # Vercel AI SDK wrapper
│   └── cli/              # Command-line interface
├── agents/
│   ├── pm/               # Product Manager agent
│   ├── tech-lead/        # Tech Lead agent
│   ├── developer/        # Developer agent
│   └── qa/               # QA Engineer agent
└── docs/
```

## Stack

- **Runtime**: Node.js 22, TypeScript 5
- **Package Manager**: pnpm workspaces
- **API Framework**: Hono
- **Database**: PostgreSQL 16 + Drizzle ORM
- **LLM**: Vercel AI SDK (OpenAI, Anthropic)
- **Frontend**: Next.js 15, React 19, Tailwind CSS v4, Tremor
- **Validation**: Zod

## Agent Roles

| Role | Name | Responsibilities |
|------|------|------------------|
| 📋 PM | Reginald | Analyzes requirements, creates user stories, prioritizes backlog |
| 🏗️ Tech Lead | Cornelius | Makes architectural decisions, reviews code, mentors developers |
| ⚙️ Backend Dev | Bartholomew | Develops APIs, handles database operations |
| 🧪 QA | Percival | Writes tests, finds bugs, ensures quality |

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://hivemi:hivemi@localhost:5432/hivemi

# Services
REGISTRY_URL=http://localhost:4001
MANAGER_URL=http://localhost:4000

# Auth
HIVEMI_SECRET=your-shared-secret

# LLM
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## API Endpoints

### Registry (:4001)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /health | Health check |
| GET/POST | /api/agents | List/Create agents |
| GET/PUT/DELETE | /api/agents/:id | Agent CRUD |
| POST | /api/agents/:id/heartbeat | Agent heartbeat |
| GET/POST | /api/roles | List/Create roles |
| GET/POST | /api/tasks | List/Create tasks |
| POST | /api/tasks/:id/retry | Retry failed task |
| POST | /api/tasks/:id/cancel | Cancel task |
| GET/POST | /api/teams | List/Create teams |
| GET | /api/logs | Get logs |

### Manager (:4000)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /health | Health check |
| POST | /api/demands | Create external task |
| GET | /api/status | Cluster status |
| GET | /api/agents | Proxy to registry |
| GET | /api/roles | Proxy to registry |
| GET | /api/teams | Proxy to registry |

## License

MIT
