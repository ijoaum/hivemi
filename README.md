<p align="center">
  <img src="docs/images/logo.png" alt="HiveMI Logo" width="120" />
</p>

<h1 align="center">🐝 HiveMI - Hive Mesh Intelligence</h1>

<p align="center">
  <strong>An AI agent orchestration platform where agents work like a dev squad.</strong>
</p>

<p align="center">
  <img src="docs/images/dashboard-preview.png" alt="HiveMI Dashboard" width="100%" />
</p>

---

## Overview

HiveMI is a platform for orchestrating AI agents that collaborate like a real development team. Each agent has a specific role (PM, Tech Lead, Developer, QA) and they work together to complete tasks, review code, and ship features.

### Key Features

- 🤖 **Role-based Agents** - PM, Tech Lead, Developer, QA with specialized prompts
- 🔄 **Real-time Dashboard** - Monitor agents, tasks, and logs in real-time
- 📱 **Mobile Responsive** - Full functionality on any device
- 🎯 **Task Management** - Create, assign, and track tasks across teams
- 🔌 **LLM Agnostic** - Works with OpenAI, Anthropic, and more via Vercel AI SDK
- 🐳 **Docker Ready** - One command to run the entire stack

---

## Architecture

HiveMI uses a unified gateway architecture where all external traffic goes through a single port.

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    EXTERNAL ACCESS                       │
                    │                      Port 3000                           │
                    └───────────────────────────┬─────────────────────────────┘
                                                │
                    ┌───────────────────────────▼─────────────────────────────┐
                    │                                                          │
                    │                  NEXT.JS GATEWAY                         │
                    │                     (:3000)                              │
                    │                                                          │
                    │   /              → Dashboard UI (React)                  │
                    │   /api/agents    → Proxy to Registry                     │
                    │   /api/tasks     → Proxy to Registry                     │
                    │   /api/roles     → Proxy to Registry                     │
                    │   /api/teams     → Proxy to Registry                     │
                    │   /api/demands   → Proxy to Manager                      │
                    │   /api/events    → SSE real-time updates                 │
                    │                                                          │
                    └─────────────────┬───────────────────┬───────────────────┘
                                      │                   │
                    ┌─────────────────▼───────┐ ┌────────▼────────────────────┐
                    │                         │ │                              │
                    │       REGISTRY          │ │         MANAGER              │
                    │        (:4001)          │ │         (:4000)              │
                    │                         │ │                              │
                    │  - Agent CRUD           │ │  - External task intake      │
                    │  - Task management      │ │  - Agent orchestration       │
                    │  - Role definitions     │ │  - Cluster status            │
                    │  - Team management      │ │  - Health monitoring         │
                    │  - Logs                 │ │                              │
                    │                         │ │                              │
                    │   ┌─────────────────┐   │ └──────────────────────────────┘
                    │   │   PostgreSQL    │   │
                    │   │     (:5432)     │   │
                    │   └─────────────────┘   │
                    └─────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
      ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
      │  PM Agent   │◄───────►│  Tech Lead  │◄───────►│  Developer  │
      │  Reginald   │   P2P   │  Cornelius  │   P2P   │ Bartholomew │
      └─────────────┘         └─────────────┘         └─────────────┘
```

### Components

| Component | Port | Description |
|-----------|------|-------------|
| **Dashboard** | 3000 | Next.js 15 + React 19 frontend, serves as the unified gateway |
| **Registry** | 4001 (internal) | Hono API + Drizzle ORM, data persistence layer |
| **Manager** | 4000 (internal) | Hono API, agent orchestration and external task intake |
| **PostgreSQL** | 5432 (internal) | Database for agents, tasks, roles, teams, logs |

---

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

# Run database migrations
pnpm --filter @hivemi/registry db:migrate

# Seed initial data (roles, teams)
pnpm --filter @hivemi/registry db:seed

# Start all services
pnpm dev
```

Open http://localhost:3000 to access the dashboard.

### Using Docker Compose

```bash
# Start everything
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

---

## Project Structure

```
hivemi/
├── apps/
│   ├── dashboard/        # Next.js 15 + React 19 (unified gateway)
│   ├── registry/         # Hono API + Drizzle + PostgreSQL
│   └── manager/          # Hono API (agent orchestration)
├── packages/
│   ├── protocol/         # Shared types + Zod schemas
│   ├── agent-runtime/    # Base agent framework
│   ├── api-client/       # TypeScript API client
│   ├── llm/              # Vercel AI SDK wrapper
│   └── cli/              # Command-line interface
├── agents/
│   ├── pm/               # Product Manager agent
│   ├── tech-lead/        # Tech Lead agent
│   ├── developer/        # Developer agent
│   └── qa/               # QA Engineer agent
├── docs/
│   └── images/           # Screenshots and logo
└── docker-compose.yml
```

---

## Tech Stack

| Category | Technology |
|----------|------------|
| **Runtime** | Node.js 22, TypeScript 5 |
| **Package Manager** | pnpm workspaces |
| **Frontend** | Next.js 15, React 19, Tailwind CSS v4 |
| **API** | Hono |
| **Database** | PostgreSQL 16 + Drizzle ORM |
| **LLM** | Vercel AI SDK (OpenAI, Anthropic) |
| **Validation** | Zod |

---

## Agent Roles

| Role | Name | Emoji | Responsibilities |
|------|------|-------|------------------|
| PM | Reginald | 📋 | Analyzes requirements, creates user stories, prioritizes backlog |
| Tech Lead | Cornelius | 🏗️ | Makes architectural decisions, reviews code, mentors developers |
| Developer | Bartholomew | ⚙️ | Implements features, writes code, fixes bugs |
| QA | Percival | 🧪 | Writes tests, finds bugs, ensures quality |

---

## Environment Variables

Create a `.env` file in the root:

```bash
# Database
DATABASE_URL=postgresql://hivemi:hivemi@localhost:5432/hivemi

# LLM (at least one required)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Optional
HIVEMI_SECRET=your-shared-secret
```

---

## API Reference

All API endpoints are accessible through the dashboard gateway at port 3000.

### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/agents | List all agents |
| POST | /api/agents | Create agent |
| GET | /api/agents/:id | Get agent by ID |
| PUT | /api/agents/:id | Update agent |
| DELETE | /api/agents/:id | Delete agent |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/tasks | List all tasks |
| POST | /api/tasks | Create task |
| GET | /api/tasks/:id | Get task by ID |
| POST | /api/tasks/:id/retry | Retry failed task |
| POST | /api/tasks/:id/cancel | Cancel task |

### Teams & Roles

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/teams | List all teams |
| GET | /api/roles | List all roles |

### External Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/demands | Create external task (via Manager) |

---

## CLI Usage

```bash
# Check cluster status
pnpm cli status

# List agents
pnpm cli agents list

# Create a task
pnpm cli tasks create "Build login page" --team <team-id> --priority high

# List tasks
pnpm cli tasks list
```

---

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build

# Type check
pnpm typecheck

# Lint
pnpm lint
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

**Dual Licensed:**

| Use Case | License | Cost |
|----------|---------|------|
| Personal, Educational, Open Source | AGPL-3.0 | Free |
| Commercial, Closed-source | [Commercial License](mailto:joao@lana.dev) | Contact |

The AGPL license requires you to publish your source code if you use HiveMI in a network service. For commercial use without this obligation, contact for a commercial license.

📧 **Questions:** joao@lana.dev

---

© [João Lana](https://github.com/ijoaum)
