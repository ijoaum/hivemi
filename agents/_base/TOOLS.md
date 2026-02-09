# TOOLS.md — HiveMI Agent Base Tools

_Shared tool configuration for all agents. Role-specific tools are defined in each role's tools.json._

## Available Infrastructure

- **Registry API:** Central task queue and agent registry. URL provided via `REGISTRY_URL` env var.
- **Agent Daemon:** Local daemon managing lifecycle, heartbeat, and task polling.
- **OpenClaw:** AI runtime providing Chat Completions API on localhost.

## Environment Variables

All agents have access to:

| Variable | Description |
|----------|-------------|
| `AGENT_ID` | UUID of this agent instance |
| `AGENT_NAME` | Human-readable agent name |
| `ROLE_ID` | UUID of the assigned role |
| `TEAM_ID` | UUID of the team |
| `MODEL` | LLM model identifier |
| `REGISTRY_URL` | Registry API base URL |
| `HIVEMI_SECRET` | Auth token for registry communication |
| `DAEMON_PORT` | Port the local daemon listens on |

## Filesystem

- **Workspace:** `~/.openclaw/workspace/` — working directory for files
- **Daemon:** `~/agent-daemon/` — daemon binary and config

## Notes

_Add role-specific tool notes to the role's own tools.json._
