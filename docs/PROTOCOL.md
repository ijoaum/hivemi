# Protocolo de Comunicação HiveMI

## Visão Geral

O protocolo HiveMI define como os componentes se comunicam:

- **Manager ↔ Registry:** REST HTTP
- **Agent ↔ Registry:** REST HTTP
- **Agent ↔ Agent:** REST HTTP (P2P direto)
- **Manager → Agent:** REST HTTP (delegação inicial)

Toda comunicação usa JSON e requer autenticação via shared secret.

## Autenticação

Todas as requests incluem o header:

```
Authorization: Bearer {HIVEMI_SECRET}
```

Requests sem auth ou com secret inválido recebem:

```json
{
  "error": "Unauthorized",
  "code": "AUTH_FAILED"
}
```

## Endpoints do Registry

### Agentes

#### POST /agents — Registrar Agente

```http
POST /agents
Authorization: Bearer {secret}
Content-Type: application/json

{
  "id": "pm-1",
  "role": "product-manager",
  "endpoint": "http://localhost:3001",
  "capabilities": ["break-down-tasks", "prioritize", "user-stories"],
  "metadata": {
    "version": "1.0.0"
  }
}
```

**Resposta (201):**

```json
{
  "id": "pm-1",
  "role": "product-manager",
  "endpoint": "http://localhost:3001",
  "capabilities": ["break-down-tasks", "prioritize", "user-stories"],
  "status": "online",
  "lastHeartbeat": "2024-02-07T04:00:00Z",
  "createdAt": "2024-02-07T04:00:00Z"
}
```

#### GET /agents — Listar Agentes

```http
GET /agents
GET /agents?role=product-manager
GET /agents?status=online
GET /agents?capability=prioritize
```

**Resposta (200):**

```json
{
  "agents": [
    {
      "id": "pm-1",
      "role": "product-manager",
      "endpoint": "http://localhost:3001",
      "status": "online",
      "currentTask": null,
      "lastHeartbeat": "2024-02-07T04:00:00Z"
    },
    {
      "id": "dev-1",
      "role": "developer",
      "endpoint": "http://localhost:3002",
      "status": "busy",
      "currentTask": "task-123",
      "lastHeartbeat": "2024-02-07T04:00:00Z"
    }
  ]
}
```

#### GET /agents/:id — Detalhes do Agente

```http
GET /agents/pm-1
```

**Resposta (200):**

```json
{
  "id": "pm-1",
  "role": "product-manager",
  "endpoint": "http://localhost:3001",
  "capabilities": ["break-down-tasks", "prioritize", "user-stories"],
  "status": "online",
  "currentTask": null,
  "lastHeartbeat": "2024-02-07T04:00:00Z",
  "metadata": {
    "version": "1.0.0"
  },
  "createdAt": "2024-02-07T04:00:00Z",
  "updatedAt": "2024-02-07T04:00:00Z"
}
```

#### PUT /agents/:id — Atualizar Agente

```http
PUT /agents/pm-1
Authorization: Bearer {secret}
Content-Type: application/json

{
  "status": "busy",
  "currentTask": "task-123"
}
```

**Resposta (200):**

```json
{
  "id": "pm-1",
  "status": "busy",
  "currentTask": "task-123",
  "updatedAt": "2024-02-07T04:01:00Z"
}
```

#### DELETE /agents/:id — Remover Agente

```http
DELETE /agents/pm-1
Authorization: Bearer {secret}
```

**Resposta (204):** No content

#### POST /agents/:id/heartbeat — Heartbeat

```http
POST /agents/pm-1/heartbeat
Authorization: Bearer {secret}
Content-Type: application/json

{
  "status": "online",
  "currentTask": null,
  "metrics": {
    "tasksCompleted": 5,
    "uptime": 3600
  }
}
```

**Resposta (200):**

```json
{
  "acknowledged": true,
  "nextHeartbeat": 30
}
```

### Roles

#### POST /roles — Criar Role

```http
POST /roles
Authorization: Bearer {secret}
Content-Type: application/json

{
  "id": "product-manager",
  "name": "Product Manager",
  "description": "Recebe demandas, quebra em tasks, prioriza e delega",
  "systemPrompt": "Você é um Product Manager experiente...",
  "capabilities": ["break-down-tasks", "prioritize", "user-stories"],
  "canDelegateTo": ["tech-lead", "designer"]
}
```

**Resposta (201):**

```json
{
  "id": "product-manager",
  "name": "Product Manager",
  "description": "Recebe demandas, quebra em tasks, prioriza e delega",
  "capabilities": ["break-down-tasks", "prioritize", "user-stories"],
  "canDelegateTo": ["tech-lead", "designer"],
  "createdAt": "2024-02-07T04:00:00Z"
}
```

#### GET /roles — Listar Roles

```http
GET /roles
```

**Resposta (200):**

```json
{
  "roles": [
    {
      "id": "product-manager",
      "name": "Product Manager",
      "description": "Recebe demandas, quebra em tasks, prioriza e delega",
      "agentCount": 1
    },
    {
      "id": "developer",
      "name": "Developer",
      "description": "Implementa features e corrige bugs",
      "agentCount": 3
    }
  ]
}
```

### Tasks (Tracking)

#### POST /tasks — Registrar Task

```http
POST /tasks
Authorization: Bearer {secret}
Content-Type: application/json

{
  "id": "task-123",
  "title": "Implementar tela de login",
  "description": "Criar tela de login com email e senha",
  "priority": "high",
  "createdBy": "pm-1",
  "assignedTo": "dev-1",
  "parentTask": "task-100"
}
```

#### PUT /tasks/:id — Atualizar Task

```http
PUT /tasks/task-123
Authorization: Bearer {secret}
Content-Type: application/json

{
  "status": "in-progress"
}
```

## Endpoints do Agent

Cada agente expõe estes endpoints:

### POST /message — Receber Mensagem

```http
POST /message
Authorization: Bearer {secret}
Content-Type: application/json

{
  "id": "msg-uuid-123",
  "from": "pm-1",
  "type": "task",
  "payload": {
    "taskId": "task-123",
    "title": "Implementar tela de login",
    "description": "Criar tela de login com email e senha",
    "priority": "high",
    "context": {
      "designSpec": "https://figma.com/...",
      "requirements": ["email validation", "password strength"]
    }
  },
  "replyTo": null,
  "timestamp": "2024-02-07T04:00:00Z"
}
```

**Resposta (202):**

```json
{
  "accepted": true,
  "messageId": "msg-uuid-123",
  "estimatedCompletion": "2024-02-07T04:30:00Z"
}
```

**Resposta (429) — Ocupado:**

```json
{
  "accepted": false,
  "reason": "Agent is busy",
  "currentTask": "task-456",
  "retryAfter": 300
}
```

### GET /status — Status do Agente

```http
GET /status
Authorization: Bearer {secret}
```

**Resposta (200):**

```json
{
  "id": "dev-1",
  "role": "developer",
  "status": "busy",
  "currentTask": {
    "id": "task-123",
    "title": "Implementar tela de login",
    "startedAt": "2024-02-07T04:00:00Z",
    "progress": 60
  },
  "queue": 2,
  "uptime": 3600,
  "tasksCompleted": 5
}
```

### GET /health — Healthcheck

```http
GET /health
```

**Resposta (200):**

```json
{
  "healthy": true,
  "timestamp": "2024-02-07T04:00:00Z"
}
```

## Tipos de Mensagem

### task — Atribuição de Tarefa

```json
{
  "type": "task",
  "payload": {
    "taskId": "task-123",
    "title": "Implementar tela de login",
    "description": "Descrição detalhada...",
    "priority": "high",
    "deadline": "2024-02-08T00:00:00Z",
    "context": {
      "relatedTasks": ["task-100"],
      "resources": ["https://..."],
      "constraints": ["must use React"]
    }
  }
}
```

### question — Pergunta

```json
{
  "type": "question",
  "payload": {
    "question": "Qual biblioteca de validação devo usar?",
    "context": {
      "taskId": "task-123",
      "options": ["Zod", "Yup", "Joi"]
    },
    "urgency": "medium"
  }
}
```

### response — Resposta

```json
{
  "type": "response",
  "replyTo": "msg-uuid-123",
  "payload": {
    "answer": "Use Zod, é mais type-safe",
    "reasoning": "Integra melhor com TypeScript...",
    "references": ["https://zod.dev"]
  }
}
```

### status — Atualização de Status

```json
{
  "type": "status",
  "payload": {
    "taskId": "task-123",
    "status": "in-progress",
    "progress": 60,
    "notes": "Frontend pronto, falta integrar API",
    "blockers": []
  }
}
```

### handoff — Passagem de Responsabilidade

```json
{
  "type": "handoff",
  "payload": {
    "taskId": "task-123",
    "from": "dev-1",
    "to": "qa-1",
    "reason": "Implementação concluída, pronto para testes",
    "artifacts": {
      "prUrl": "https://github.com/.../pull/123",
      "testInstructions": "..."
    }
  }
}
```

## Códigos de Erro

| Código | Significado |
|--------|-------------|
| `AUTH_FAILED` | Autenticação inválida |
| `NOT_FOUND` | Recurso não encontrado |
| `AGENT_BUSY` | Agente ocupado, tentar depois |
| `AGENT_OFFLINE` | Agente não está online |
| `INVALID_PAYLOAD` | Payload não passou validação |
| `ROLE_NOT_FOUND` | Role não existe |
| `DELEGATION_NOT_ALLOWED` | Agente não pode delegar pra esse role |
| `TASK_NOT_FOUND` | Task não encontrada |
| `CIRCULAR_DELEGATION` | Delegação circular detectada |

## Schemas (Zod)

```typescript
import { z } from 'zod'

// Prioridade
export const PrioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])

// Status de agente
export const AgentStatusSchema = z.enum(['online', 'busy', 'offline'])

// Status de task
export const TaskStatusSchema = z.enum([
  'pending', 'assigned', 'in-progress', 'review', 'done', 'cancelled'
])

// Tipo de mensagem
export const MessageTypeSchema = z.enum([
  'task', 'question', 'response', 'status', 'handoff'
])

// Registro de agente
export const AgentRegisterSchema = z.object({
  id: z.string().min(1).max(64),
  role: z.string().min(1).max(64),
  endpoint: z.string().url(),
  capabilities: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).optional()
})

// Mensagem entre agentes
export const MessageSchema = z.object({
  id: z.string().uuid(),
  from: z.string(),
  type: MessageTypeSchema,
  payload: z.record(z.unknown()),
  replyTo: z.string().uuid().optional(),
  timestamp: z.string().datetime()
})

// Task
export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(500),
  description: z.string(),
  priority: PrioritySchema,
  status: TaskStatusSchema.default('pending'),
  createdBy: z.string(),
  assignedTo: z.string().optional(),
  parentTask: z.string().optional(),
  context: z.record(z.unknown()).optional()
})

// Role
export const RoleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  description: z.string(),
  systemPrompt: z.string(),
  capabilities: z.array(z.string()).default([]),
  canDelegateTo: z.array(z.string()).default([])
})
```

## Exemplos de Fluxo

### Fluxo Completo: Nova Feature

```
1. Humano → Manager
   POST /tasks
   {"title": "Adicionar dark mode", "description": "..."}

2. Manager → Registry
   GET /agents?role=product-manager&status=online

3. Manager → PM Agent
   POST /message
   {"type": "task", "payload": {...}}

4. PM Agent → Registry
   PUT /agents/pm-1
   {"status": "busy", "currentTask": "task-1"}

5. PM Agent processa (LLM)
   Quebra em subtasks

6. PM Agent → Registry
   POST /tasks (registra subtasks)
   GET /agents?role=developer&status=online

7. PM Agent → Dev Agent
   POST /message
   {"type": "task", "payload": {subtask}}

8. Dev Agent → Registry
   PUT /agents/dev-1
   {"status": "busy", "currentTask": "task-1-1"}

9. Dev Agent processa (LLM)
   Implementa

10. Dev Agent → PM Agent
    POST /message
    {"type": "handoff", "payload": {done}}

11. Dev Agent → Registry
    PUT /agents/dev-1
    {"status": "online", "currentTask": null}
    PUT /tasks/task-1-1
    {"status": "done"}

12. PM Agent → Manager (ou direto pro humano)
    {"status": "done", "result": {...}}
```
