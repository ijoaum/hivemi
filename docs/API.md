# HiveMI API Reference

Complete API documentation for the HiveMI platform.

## Base URLs

- **Registry**: `http://localhost:4001`
- **Manager**: `http://localhost:4000`

## Authentication

All endpoints (except `/health`) require Bearer token authentication when `HIVEMI_SECRET` is set:

```
Authorization: Bearer <your-secret>
```

## Response Format

All responses follow this structure:

```json
{
  "success": true,
  "data": { ... },
  "error": "Error message if success=false"
}
```

---

## Registry API

### Health Check

```
GET /health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-02-07T12:00:00.000Z"
}
```

---

### Teams

#### List Teams

```
GET /api/teams
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "HiveMI",
      "emoji": "🐝",
      "color": "amber",
      "createdAt": "2026-02-07T12:00:00.000Z",
      "updatedAt": "2026-02-07T12:00:00.000Z"
    }
  ]
}
```

#### Create Team

```
POST /api/teams
Content-Type: application/json

{
  "name": "Pipeline",
  "emoji": "🚀",
  "color": "purple"
}
```

---

### Roles

#### List Roles

```
GET /api/roles
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Product Manager",
      "slug": "pm",
      "description": "Analyzes requirements...",
      "icon": "📋",
      "color": "blue",
      "capabilities": ["requirement-analysis", "story-creation"],
      "systemPrompt": "You are a PM agent...",
      "createdAt": "2026-02-07T12:00:00.000Z"
    }
  ]
}
```

#### Get Role

```
GET /api/roles/:id
```

#### Create Role

```
POST /api/roles
Content-Type: application/json

{
  "name": "DevOps Engineer",
  "slug": "devops",
  "description": "Manages infrastructure and deployments",
  "icon": "🔧",
  "color": "gray",
  "capabilities": ["infrastructure", "ci-cd"],
  "systemPrompt": "You are a DevOps agent..."
}
```

#### Update Role

```
PUT /api/roles/:id
Content-Type: application/json

{
  "description": "Updated description"
}
```

#### Delete Role

```
DELETE /api/roles/:id
```

---

### Agents

#### List Agents

```
GET /api/agents
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Bartholomew",
      "roleId": "uuid",
      "teamId": "uuid",
      "status": "idle",
      "model": "openai/gpt-4o",
      "host": "http://localhost",
      "port": 3001,
      "currentTaskId": null,
      "lastHeartbeat": "2026-02-07T12:00:00.000Z",
      "createdAt": "2026-02-07T12:00:00.000Z"
    }
  ]
}
```

#### Get Agent

```
GET /api/agents/:id
```

#### Create Agent

```
POST /api/agents
Content-Type: application/json

{
  "name": "Reginald",
  "roleId": "uuid",
  "teamId": "uuid",
  "model": "openai/gpt-4o",
  "host": "http://localhost",
  "port": 3002
}
```

#### Update Agent

```
PUT /api/agents/:id
Content-Type: application/json

{
  "status": "working",
  "currentTaskId": "uuid"
}
```

#### Delete Agent

```
DELETE /api/agents/:id
```

#### Heartbeat

```
POST /api/agents/:id/heartbeat
```

Updates `lastHeartbeat` and sets status to `idle`.

---

### Tasks

#### List Tasks

```
GET /api/tasks
GET /api/tasks?status=running
GET /api/tasks?teamId=uuid
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Build login page",
      "description": "Create a login form with email/password",
      "status": "queued",
      "priority": "high",
      "agentId": null,
      "teamId": "uuid",
      "input": null,
      "output": null,
      "error": null,
      "estimatedMs": null,
      "elapsedMs": null,
      "createdAt": "2026-02-07T12:00:00.000Z",
      "startedAt": null,
      "completedAt": null
    }
  ]
}
```

#### Get Task

```
GET /api/tasks/:id
```

#### Create Task

```
POST /api/tasks
Content-Type: application/json

{
  "title": "Implement user authentication",
  "description": "Add JWT-based auth",
  "priority": "high",
  "teamId": "uuid",
  "input": "Use bcrypt for password hashing"
}
```

#### Update Task

```
PUT /api/tasks/:id
Content-Type: application/json

{
  "status": "completed",
  "output": "Implementation complete...",
  "completedAt": "2026-02-07T12:30:00.000Z"
}
```

#### Retry Task

Re-queues a failed task.

```
POST /api/tasks/:id/retry
```

#### Cancel Task

```
POST /api/tasks/:id/cancel
```

---

### Logs

#### List Logs

```
GET /api/logs
GET /api/logs?limit=100
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "timestamp": "2026-02-07T12:00:00.000Z",
      "level": "info",
      "source": "registry",
      "agentId": null,
      "taskId": null,
      "message": "Server started",
      "metadata": null
    }
  ]
}
```

#### Create Log

```
POST /api/logs
Content-Type: application/json

{
  "level": "info",
  "source": "agent-pm",
  "agentId": "uuid",
  "message": "Task completed successfully"
}
```

---

## Manager API

### Health Check

```
GET /health
```

### Create Demand

Creates a new task from an external source.

```
POST /api/demands
Content-Type: application/json

{
  "title": "Build dashboard feature",
  "description": "Add charts to the dashboard",
  "priority": "medium",
  "teamId": "uuid",
  "input": "Use Tremor for charts"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "task": { ... },
    "assignedTo": {
      "id": "uuid",
      "name": "Reginald"
    }
  }
}
```

If no agent is available:
```json
{
  "success": true,
  "data": {
    "task": { ... },
    "assignedTo": null,
    "message": "Task queued, waiting for available agent"
  }
}
```

### Cluster Status

```
GET /api/status
```

Response:
```json
{
  "success": true,
  "data": {
    "agents": {
      "total": 5,
      "online": 4,
      "working": 2,
      "idle": 2,
      "error": 0
    },
    "roles": 4,
    "teams": 3,
    "timestamp": "2026-02-07T12:00:00.000Z"
  }
}
```

### Proxy Endpoints

The Manager proxies these requests to the Registry:

```
GET /api/agents  → Registry /api/agents
GET /api/roles   → Registry /api/roles
GET /api/teams   → Registry /api/teams
```

---

## Agent Endpoints

Each agent exposes these endpoints:

### Health

```
GET /health
```

Response:
```json
{
  "status": "ok",
  "agent": "Bartholomew",
  "id": "uuid",
  "timestamp": "2026-02-07T12:00:00.000Z"
}
```

### Receive Task

```
POST /task
Content-Type: application/json

{
  "id": "uuid",
  "title": "Task title",
  "description": "...",
  "input": "..."
}
```

### P2P Message

```
POST /message
Content-Type: application/json

{
  "id": "uuid",
  "type": "agent:request",
  "from": "uuid",
  "to": "uuid",
  "payload": { "question": "..." },
  "timestamp": "2026-02-07T12:00:00.000Z"
}
```

---

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (missing token) |
| 403 | Forbidden (invalid token) |
| 404 | Not Found |
| 500 | Internal Server Error |

---

## WebSocket (Coming Soon)

```
ws://localhost:4000/ws
```

Events:
- `agent:status` — Agent status changed
- `task:status` — Task status changed
- `task:created` — New task created
- `log:new` — New log entry
