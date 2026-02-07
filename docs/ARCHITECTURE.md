# Arquitetura HiveMI

## Visão Geral

HiveMI é uma plataforma de orquestração de agentes de IA com arquitetura peer-to-peer e discovery centralizado.

```
┌─────────────────────────────────────────────────────────────────┐
│                          EXTERNOS                               │
│              (Humanos, APIs, Webhooks, CI/CD)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          MANAGER                                │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │   REST API    │  │   Dashboard   │  │   Webhooks    │       │
│  │  POST /tasks  │  │   (futuro)    │  │   (futuro)    │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         REGISTRY                                │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │    Agents     │  │     Roles     │  │     Tasks     │       │
│  │   (online)    │  │  (templates)  │  │   (tracking)  │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
│                              │                                  │
│                         PostgreSQL                              │
└─────────────────────────────────────────────────────────────────┘
                              ▲
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    ┌────┴─────┐        ┌─────┴────┐        ┌─────┴────┐
    │  Agent   │◄──────►│  Agent   │◄──────►│  Agent   │
    │   (PM)   │        │  (Tech)  │        │  (Dev)   │
    │  :3001   │        │  :3002   │        │  :3003   │
    └──────────┘        └──────────┘        └──────────┘
         ▲                                       ▲
         └───────────────────────────────────────┘
                    Comunicação P2P direta
```

## Componentes

### Manager

**Responsabilidade:** Ponto de entrada para o mundo externo.

- Recebe demandas de humanos, APIs externas, webhooks
- Consulta Registry para encontrar o agente certo
- Delega tasks para agentes (geralmente começa pelo PM)
- Oferece dashboard para visualizar estado do sistema
- **NÃO** participa do fluxo interno entre agentes
- **NÃO** recebe tasks de agentes internos

**Endpoints:**

```
POST   /tasks              # Cria nova demanda
GET    /tasks              # Lista demandas
GET    /tasks/:id          # Detalhes de uma demanda
GET    /tasks/:id/status   # Status detalhado (árvore de subtasks)
DELETE /tasks/:id          # Cancela demanda

GET    /dashboard          # Visão geral do sistema
GET    /agents             # Proxy pro Registry (conveniência)
```

### Registry

**Responsabilidade:** Service discovery e estado compartilhado.

- Armazena quais agentes estão online e seus endpoints
- Armazena definições de Roles (templates de agentes)
- Tracking de tasks em andamento
- Healthcheck de agentes (detecta mortos)

**Endpoints:**

```
# Agentes
POST   /agents             # Registra agente (agent se cadastra)
GET    /agents             # Lista agentes online
GET    /agents/:id         # Detalhes de um agente
PUT    /agents/:id         # Atualiza status/task atual
DELETE /agents/:id         # Remove agente (agent morrendo)
POST   /agents/:id/heartbeat  # Heartbeat pra manter vivo

# Roles
POST   /roles              # Cria novo role
GET    /roles              # Lista roles
GET    /roles/:id          # Detalhes de um role
PUT    /roles/:id          # Atualiza role
DELETE /roles/:id          # Remove role

# Tasks (tracking central)
POST   /tasks              # Registra task (pra tracking)
GET    /tasks              # Lista tasks
GET    /tasks/:id          # Detalhes
PUT    /tasks/:id          # Atualiza status
```

### Agent

**Responsabilidade:** Unidade de trabalho inteligente.

Cada agente é um processo independente que:
1. Ao iniciar → se registra no Registry
2. Periodicamente → manda heartbeat pro Registry
3. Recebe mensagens → processa (usa LLM)
4. Pode enviar mensagens → consulta Registry, manda direto P2P
5. Ao terminar → se remove do Registry

**Endpoints (cada agente expõe):**

```
POST   /message            # Recebe mensagem de outro agente
GET    /status             # Retorna status atual
GET    /health             # Healthcheck
```

**Lifecycle:**

```
┌─────────┐
│  START  │
└────┬────┘
     │
     ▼
┌─────────────────┐
│ Register with   │──────────────────────────────┐
│ Registry        │                              │
└────────┬────────┘                              │
         │                                       │
         ▼                                       ▼
┌─────────────────┐                    ┌─────────────────┐
│ Wait for        │◄───────────────────│ Send Heartbeat  │
│ messages        │    (every 30s)     │ to Registry     │
└────────┬────────┘                    └─────────────────┘
         │
         ▼
┌─────────────────┐
│ Process message │
│ (call LLM)      │
└────────┬────────┘
         │
         ├──────────────────┐
         ▼                  ▼
┌─────────────────┐  ┌─────────────────┐
│ Update status   │  │ Send message to │
│ in Registry     │  │ other agents    │
└─────────────────┘  └─────────────────┘
```

## Modelo de Dados

### Agent (no Registry)

```typescript
interface Agent {
  id: string              // Identificador único (ex: "pm-1")
  role: string            // ID do role (ex: "product-manager")
  endpoint: string        // URL HTTP (ex: "http://localhost:3001")
  capabilities: string[]  // O que sabe fazer
  status: 'online' | 'busy' | 'offline'
  currentTask?: string    // ID da task atual (se busy)
  lastHeartbeat: Date     // Último heartbeat recebido
  metadata?: object       // Dados extras
  createdAt: Date
  updatedAt: Date
}
```

### Role

```typescript
interface Role {
  id: string              // Identificador (ex: "product-manager")
  name: string            // Nome legível (ex: "Product Manager")
  description: string     // O que esse role faz
  systemPrompt: string    // System prompt pro LLM
  capabilities: string[]  // Capabilities padrão
  canDelegateTo: string[] // Roles pra quem pode delegar
  createdAt: Date
  updatedAt: Date
}
```

### Task

```typescript
interface Task {
  id: string
  externalId?: string     // ID de sistema externo
  title: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'pending' | 'assigned' | 'in-progress' | 'review' | 'done' | 'cancelled'
  
  createdBy: string       // "manager" ou agent ID
  assignedTo?: string     // Agent ID
  parentTask?: string     // Task ID (pra subtasks)
  
  context?: object        // Dados adicionais
  result?: object         // Resultado quando done
  
  createdAt: Date
  updatedAt: Date
  completedAt?: Date
}
```

### Message

```typescript
interface Message {
  id: string
  from: string            // Agent ID
  to: string              // Agent ID
  type: 'task' | 'question' | 'response' | 'status' | 'handoff'
  payload: object         // Conteúdo específico do type
  replyTo?: string        // Message ID (se for resposta)
  timestamp: Date
}
```

## Fluxos

### Criar Demanda Externa

```
Humano                    Manager                 Registry              PM Agent
   │                         │                       │                      │
   │  POST /tasks            │                       │                      │
   │  {title, description}   │                       │                      │
   │────────────────────────►│                       │                      │
   │                         │                       │                      │
   │                         │  GET /agents?role=pm  │                      │
   │                         │──────────────────────►│                      │
   │                         │                       │                      │
   │                         │  [{id:"pm-1", ...}]   │                      │
   │                         │◄──────────────────────│                      │
   │                         │                       │                      │
   │                         │  POST /message (task) │                      │
   │                         │─────────────────────────────────────────────►│
   │                         │                       │                      │
   │                         │  {accepted: true}     │                      │
   │                         │◄─────────────────────────────────────────────│
   │                         │                       │                      │
   │  {taskId, status}       │                       │                      │
   │◄────────────────────────│                       │                      │
```

### Delegação entre Agentes

```
PM Agent                  Registry              Dev Agent
   │                         │                      │
   │  GET /agents?role=dev   │                      │
   │────────────────────────►│                      │
   │                         │                      │
   │  [{id:"dev-1", ...}]    │                      │
   │◄────────────────────────│                      │
   │                         │                      │
   │  POST /message (task)   │                      │
   │─────────────────────────────────────────────►│
   │                         │                      │
   │                         │  PUT /agents/dev-1   │
   │                         │  {status: "busy"}    │
   │                         │◄─────────────────────│
   │                         │                      │
   │  {accepted: true}       │                      │
   │◄─────────────────────────────────────────────│
   │                         │                      │
   │  PUT /agents/pm-1       │                      │
   │  {currentTask: ...}     │                      │
   │────────────────────────►│                      │
```

## Autenticação

### Shared Secret

Modelo simples para v1:

1. Variável `HIVEMI_SECRET` configurada em todos os componentes
2. Toda request inclui `Authorization: Bearer {secret}`
3. Componentes validam antes de processar

```typescript
// Middleware de auth
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token !== process.env.HIVEMI_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}
```

### Futuro: JWT por Agente

Para v2, cada agente pode ter seu próprio token:

1. Agente recebe JWT ao registrar
2. JWT inclui agent ID e permissões
3. Registry valida assinatura
4. Agentes podem verificar identidade do sender

## Tolerância a Falhas

### Heartbeat

- Agentes mandam heartbeat a cada 30s
- Registry marca como `offline` após 90s sem heartbeat
- Manager não delega para agentes offline

### Retry

- Mensagens P2P têm retry automático (3 tentativas)
- Se falhar, task volta pro estado anterior
- Agente sender notifica Registry

### Graceful Shutdown

- Agente recebe SIGTERM
- Manda `DELETE /agents/:id` pro Registry
- Aguarda mensagens em processamento
- Encerra

## Escalabilidade

### Horizontal

- Múltiplos agentes do mesmo Role
- Registry faz load balancing (round-robin ou least-busy)
- Stateless: qualquer agente pode pegar qualquer task

### Limites

- SQLite: ~100 agentes, ~1000 tasks simultâneas
- PostgreSQL: ~10000 agentes, ~100000 tasks
- Para mais: adicionar Redis cache, sharding

## Observabilidade

### Logs

Formato JSON estruturado (Pino):

```json
{
  "level": "info",
  "time": 1707280000,
  "component": "agent",
  "agentId": "pm-1",
  "msg": "Task received",
  "taskId": "task-123"
}
```

### Métricas (futuro)

- Tasks criadas/completadas por minuto
- Tempo médio de processamento
- Agentes online por role
- Erros por tipo

### Tracing (futuro)

- Trace ID propagado entre agentes
- Visualização do fluxo de uma task
- Tempo em cada agente
