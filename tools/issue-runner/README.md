# HiveMI Issue Runner

Sequential GitHub issue executor via OpenClaw Chat Completions API.

## What it does

1. Reads the issue queue from `.context/issue-tracker.json`
2. For each issue, fetches details + comments from GitHub
3. Builds a rich prompt with project context and rules
4. Sends it to OpenClaw's `/v1/chat/completions` endpoint (new session per issue)
5. Logs the result, comments on the GitHub issue, updates the tracker
6. Moves to the next issue

**Key property:** Each issue runs in a completely fresh session — no context carryover.

## Quick Start

```bash
# Show queue status
node runner.js --status

# Dry run — see what would execute without running
node runner.js --dry-run

# Run all queued issues
node runner.js

# Run a specific issue
node runner.js --issue 69
```

## Prerequisites

- OpenClaw Gateway running with Chat Completions enabled:
  ```json
  { "gateway": { "http": { "endpoints": { "chatCompletions": { "enabled": true } } } } }
  ```
- Sandbox mode off (agents need filesystem access):
  ```json
  { "agents": { "defaults": { "sandbox": { "mode": "off" } } } }
  ```
- GitHub token in 1Password (vault Clawdia) or `GITHUB_TOKEN` env var
- Gateway token auto-detected from `openclaw.json` or `OPENCLAW_GATEWAY_TOKEN` env var

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_GATEWAY_URL` | `http://127.0.0.1:18789` | Gateway URL |
| `OPENCLAW_GATEWAY_TOKEN` | *(from openclaw.json)* | Gateway auth token |
| `GITHUB_TOKEN` | *(from 1Password)* | GitHub API token |
| `GITHUB_REPO` | `ijoaum/hivemi` | GitHub owner/repo |
| `OPENCLAW_MODEL` | `openclaw:main` | Model for Chat Completions |
| `ISSUE_TIMEOUT_MS` | `1800000` (30min) | Max time per issue |
| `DELAY_BETWEEN_MS` | `5000` (5s) | Delay between issues |
| `ISSUE_QUEUE` | *(from tracker)* | Override queue (comma-separated) |
| `ALLOWED_AUTHORS` | `ijoaum,clawdiabot26` | Only run issues from these GitHub users |

## File Structure

```
tools/issue-runner/
├── runner.js          # Main runner script
├── package.json       # Package metadata
└── README.md          # This file

.context/
├── issue-tracker.json # Queue state + completed issues
├── runner.log         # Append-only log
├── journal.md         # Architecture journal
└── runs/              # Per-issue run results (JSON)
    └── issue-69-2026-02-08T21-00-00-000Z.json
```

## How It Works

### Session Isolation

Each issue gets its own OpenClaw session via the Chat Completions API:

```
POST /v1/chat/completions
{
  "model": "openclaw:main",
  "messages": [{"role": "user", "content": "<prompt>"}]
}
```

No `user` field = no session reuse. Every request starts clean.

### Prompt Structure

The runner builds a prompt for each issue that includes:
- Issue title and full description
- Recent comments (last 5)
- Project location and stack info
- Commit conventions and rules
- Expected output format

### Result Tracking

After each run:
- Result is saved to `.context/runs/` as JSON
- A comment is posted on the GitHub issue with status/summary
- The tracker is updated with completion status
- Labels are updated (`in-progress` → `done`)

### Reuse in HiveMI

This code is designed to be extracted into the HiveMI Agent Daemon (#47).
The core pattern is identical:

```
Agent Daemon polls task queue → builds prompt → POST /v1/chat/completions → report result
```

The main differences for production:
- Tasks come from Postgres queue instead of GitHub issues
- Results go to Registry API instead of GitHub comments
- Heartbeat/telemetry runs alongside
- Multiple roles with different prompts

## Tracker Format

```json
{
  "currentIssue": 69,
  "status": "running",
  "completedIssues": [],
  "issueQueue": [69, 44, 71, 45, 46, 48, 47, 55, 49, 50, 70, 72],
  "updatedAt": "2026-02-08T21:00:00.000Z"
}
```
