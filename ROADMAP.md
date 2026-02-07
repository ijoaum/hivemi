# HiveMI Roadmap

## Fase 1: Fundação

### Issue #1: Setup do Monorepo
**Labels:** `setup`, `priority:high`

**Descrição:**
Configurar estrutura do monorepo com pnpm workspaces.

**Tasks:**
- [ ] Criar `package.json` raiz com workspaces
- [ ] Criar `pnpm-workspace.yaml`
- [ ] Configurar TypeScript base (`tsconfig.json`)
- [ ] Configurar ESLint + Prettier
- [ ] Criar estrutura de pastas:
  ```
  packages/
    protocol/
    registry/
    manager/
    agent/
  ```

**Critério de aceite:**
- `pnpm install` funciona
- `pnpm build` compila todos os packages

---

### Issue #2: Package Protocol (Tipos Compartilhados)
**Labels:** `core`, `priority:high`

**Descrição:**
Criar package com tipos TypeScript e schemas Zod compartilhados entre todos os componentes.

**Tasks:**
- [ ] Setup do package (`packages/protocol`)
- [ ] Schemas Zod:
  - [ ] `AgentSchema`
  - [ ] `RoleSchema`
  - [ ] `TaskSchema`
  - [ ] `MessageSchema`
  - [ ] `PrioritySchema`, `StatusSchema`, etc
- [ ] Types inferidos dos schemas
- [ ] Funções de validação
- [ ] Exportar tudo via `index.ts`

**Critério de aceite:**
- Outros packages podem importar: `import { AgentSchema, Agent } from '@hivemi/protocol'`
- 100% tipado, sem `any`

---

### Issue #3: Package Registry - Setup Básico
**Labels:** `core`, `priority:high`

**Descrição:**
Criar o serviço de Registry com endpoints básicos.

**Tasks:**
- [ ] Setup do package (`packages/registry`)
- [ ] Configurar Hono
- [ ] Configurar Drizzle + PostgreSQL
- [ ] Schema do banco:
  - [ ] Tabela `agents`
  - [ ] Tabela `roles`
  - [ ] Tabela `tasks`
- [ ] Migrations
- [ ] Middleware de auth (shared secret)

**Critério de aceite:**
- `pnpm --filter registry dev` sobe o server
- Conecta no Postgres
- Middleware de auth funciona

---

### Issue #4: Registry - CRUD de Agents
**Labels:** `feature`, `priority:high`

**Descrição:**
Implementar endpoints de gerenciamento de agentes.

**Tasks:**
- [ ] `POST /agents` — registrar agente
- [ ] `GET /agents` — listar (com filtros: role, status, capability)
- [ ] `GET /agents/:id` — detalhes
- [ ] `PUT /agents/:id` — atualizar status/task
- [ ] `DELETE /agents/:id` — remover
- [ ] `POST /agents/:id/heartbeat` — heartbeat
- [ ] Job pra marcar offline após timeout

**Critério de aceite:**
- Todos os endpoints funcionam
- Validação com Zod
- Testes passando

---

### Issue #5: Registry - CRUD de Roles
**Labels:** `feature`, `priority:high`

**Descrição:**
Implementar endpoints de gerenciamento de roles.

**Tasks:**
- [ ] `POST /roles` — criar role
- [ ] `GET /roles` — listar
- [ ] `GET /roles/:id` — detalhes
- [ ] `PUT /roles/:id` — atualizar
- [ ] `DELETE /roles/:id` — remover
- [ ] Seed com roles padrão (PM, Tech Lead, Dev, etc)

**Critério de aceite:**
- CRUD completo funciona
- Roles padrão seedados
- Validação com Zod

---

### Issue #6: Registry - Tracking de Tasks
**Labels:** `feature`, `priority:medium`

**Descrição:**
Implementar tracking centralizado de tasks.

**Tasks:**
- [ ] `POST /tasks` — registrar task
- [ ] `GET /tasks` — listar (com filtros)
- [ ] `GET /tasks/:id` — detalhes
- [ ] `PUT /tasks/:id` — atualizar status
- [ ] Relacionamento com parent task (subtasks)

**Critério de aceite:**
- Tasks podem ser criadas e atualizadas
- Subtasks funcionam
- Filtros funcionam

---

## Fase 2: Agent Base

### Issue #7: Package Agent - Lib Base
**Labels:** `core`, `priority:high`

**Descrição:**
Criar biblioteca base para construir agentes.

**Tasks:**
- [ ] Setup do package (`packages/agent`)
- [ ] Classe `Agent` base:
  - [ ] Registro automático no Registry
  - [ ] Heartbeat loop
  - [ ] Graceful shutdown
- [ ] Server HTTP (Hono):
  - [ ] `POST /message`
  - [ ] `GET /status`
  - [ ] `GET /health`
- [ ] Cliente pra Registry
- [ ] Cliente pra comunicação P2P

**Critério de aceite:**
- Agent base pode ser instanciado
- Registra no Registry automaticamente
- Heartbeat funciona
- Recebe mensagens

---

### Issue #8: Agent - Integração com LLM
**Labels:** `feature`, `priority:high`

**Descrição:**
Integrar Vercel AI SDK para processamento de mensagens.

**Tasks:**
- [ ] Configurar Vercel AI SDK
- [ ] Suporte a múltiplos providers (OpenAI, Anthropic)
- [ ] Função `processMessage()` que:
  - [ ] Recebe mensagem
  - [ ] Usa system prompt do role
  - [ ] Chama LLM
  - [ ] Retorna resposta estruturada
- [ ] Configuração de model por agente

**Critério de aceite:**
- Agent pode processar mensagens com LLM
- Funciona com OpenAI e Anthropic
- System prompt é injetado

---

### Issue #9: Agent - Comunicação P2P
**Labels:** `feature`, `priority:high`

**Descrição:**
Implementar comunicação direta entre agentes.

**Tasks:**
- [ ] Função `sendMessage(toAgentId, message)`
- [ ] Lookup no Registry pra encontrar endpoint
- [ ] Retry automático (3 tentativas)
- [ ] Timeout configurável
- [ ] Tratamento de erros (agent offline, etc)

**Critério de aceite:**
- Agent A pode mandar mensagem pra Agent B
- Retry funciona
- Erros são tratados graciosamente

---

## Fase 3: Manager

### Issue #10: Package Manager - Setup
**Labels:** `core`, `priority:high`

**Descrição:**
Criar o serviço Manager para entrada externa.

**Tasks:**
- [ ] Setup do package (`packages/manager`)
- [ ] Configurar Hono
- [ ] Middleware de auth
- [ ] Cliente pra Registry
- [ ] Cliente pra comunicação com Agents

**Critério de aceite:**
- `pnpm --filter manager dev` sobe o server
- Conecta no Registry

---

### Issue #11: Manager - Criação de Demandas
**Labels:** `feature`, `priority:high`

**Descrição:**
Implementar endpoint para receber demandas externas.

**Tasks:**
- [ ] `POST /tasks` — criar demanda
- [ ] Lógica pra encontrar agente certo (ex: PM)
- [ ] Delegação inicial (manda pro agente)
- [ ] Tracking do status

**Critério de aceite:**
- Humano pode criar demanda via API
- Demanda é delegada pro PM
- Status é rastreado

---

### Issue #12: Manager - Status e Dashboard
**Labels:** `feature`, `priority:medium`

**Descrição:**
Endpoints para visualizar estado do sistema.

**Tasks:**
- [ ] `GET /tasks` — listar demandas
- [ ] `GET /tasks/:id` — detalhes com subtasks
- [ ] `GET /agents` — proxy pro Registry
- [ ] `GET /dashboard` — visão geral (stats)

**Critério de aceite:**
- Pode ver todas as tasks
- Pode ver árvore de subtasks
- Pode ver agentes online

---

## Fase 4: Agentes Específicos

### Issue #13: Agent PM (Product Manager)
**Labels:** `agent`, `priority:high`

**Descrição:**
Implementar agente Product Manager.

**Tasks:**
- [ ] Criar `agents/pm/`
- [ ] System prompt específico
- [ ] Lógica pra:
  - [ ] Receber demanda
  - [ ] Quebrar em subtasks
  - [ ] Delegar pro Tech Lead

**Critério de aceite:**
- PM recebe demanda
- Quebra em tasks menores
- Delega corretamente

---

### Issue #14: Agent Tech Lead
**Labels:** `agent`, `priority:high`

**Descrição:**
Implementar agente Tech Lead.

**Tasks:**
- [ ] Criar `agents/techlead/`
- [ ] System prompt específico
- [ ] Lógica pra:
  - [ ] Receber task do PM
  - [ ] Definir approach técnico
  - [ ] Delegar pra Devs

**Critério de aceite:**
- Tech Lead recebe tasks
- Define arquitetura
- Delega pra frontend/backend

---

### Issue #15: Agent Developer
**Labels:** `agent`, `priority:high`

**Descrição:**
Implementar agente Developer (frontend e backend).

**Tasks:**
- [ ] Criar `agents/dev/`
- [ ] System prompts (frontend vs backend)
- [ ] Lógica pra:
  - [ ] Receber task
  - [ ] "Implementar" (gerar código/resposta)
  - [ ] Handoff pro QA

**Critério de aceite:**
- Dev recebe tasks
- Processa e gera output
- Faz handoff

---

## Fase 5: Polish

### Issue #16: CLI
**Labels:** `tooling`, `priority:medium`

**Descrição:**
Criar CLI para gerenciar HiveMI.

**Tasks:**
- [ ] `hivemi init` — inicializa projeto
- [ ] `hivemi role create/list/delete`
- [ ] `hivemi agent spawn/list/kill`
- [ ] `hivemi task create/list/status`

---

### Issue #17: Testes E2E
**Labels:** `testing`, `priority:medium`

**Descrição:**
Testes end-to-end do fluxo completo.

**Tasks:**
- [ ] Setup Vitest
- [ ] Teste: criar demanda → PM → Tech Lead → Dev → concluído
- [ ] Teste: agent offline handling
- [ ] Teste: retry e recovery

---

### Issue #18: Documentação de Uso
**Labels:** `docs`, `priority:low`

**Descrição:**
Documentação para usuários.

**Tasks:**
- [ ] Tutorial: Quick Start
- [ ] Tutorial: Criar role customizado
- [ ] Tutorial: Deploy em produção
- [ ] API Reference completa

---

## Ordem de Execução

```
Fase 1 (Fundação):
#1 Setup Monorepo
    ↓
#2 Protocol
    ↓
#3 Registry Setup → #4 CRUD Agents → #5 CRUD Roles → #6 Tasks

Fase 2 (Agent):
#7 Agent Base → #8 LLM → #9 P2P

Fase 3 (Manager):
#10 Manager Setup → #11 Demandas → #12 Dashboard

Fase 4 (Agentes):
#13 PM → #14 Tech Lead → #15 Dev

Fase 5 (Polish):
#16 CLI, #17 Testes, #18 Docs
```

## Milestone 1: MVP

Issues mínimas pra ter algo funcionando:
- [x] Documentação inicial
- [ ] #1 Setup Monorepo
- [ ] #2 Protocol
- [ ] #3 Registry Setup
- [ ] #4 CRUD Agents
- [ ] #7 Agent Base
- [ ] #8 LLM Integration
- [ ] #9 P2P
- [ ] #13 PM Agent

**Resultado:** PM recebe demanda e processa com LLM.
