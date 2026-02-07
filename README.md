# HiveMI

**Hive Mesh Intelligence** — Orquestrador de agentes de IA distribuídos.

```
╭───────────────────────────────────╮
│          H I V E M I              │
│    Hive Mesh Intelligence         │
│                                   │
│    🐝 Agentes distribuídos        │
│    🔗 Comunicação P2P             │
│    🧠 Inteligência coletiva       │
╰───────────────────────────────────╯
```

## O que é?

HiveMI é uma plataforma para criar e orquestrar times de agentes de IA que trabalham juntos como um squad. Cada agente tem um papel específico (PM, Tech Lead, Developer, QA, etc.) e se comunica diretamente com outros agentes via HTTP.

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                        MANAGER                              │
│  (ponto de entrada externo, dashboard, não recebe tasks     │
│   de agentes internos — apenas de humanos/APIs externas)    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       REGISTRY                              │
│              (microserviço de discovery)                    │
│                                                             │
│  • Lista agentes online e seus endpoints                    │
│  • Armazena roles disponíveis                               │
│  • Tracking de status e tasks atuais                        │
└─────────────────────────────────────────────────────────────┘
                           ▲
          ┌────────────────┼────────────────┐
          │                │                │
     ┌────┴────┐      ┌────┴────┐      ┌────┴────┐
     │   PM    │◄────►│  Tech   │◄────►│   Dev   │
     │  Agent  │      │  Lead   │      │  Agent  │
     └─────────┘      └─────────┘      └─────────┘
           ▲                                ▲
           └────────────────────────────────┘
                  (comunicação direta P2P)
```

### Componentes

| Componente | Descrição |
|------------|-----------|
| **Manager** | Ponto de entrada para demandas externas. Recebe tasks de humanos/APIs, delega pro agente certo, oferece dashboard de status. |
| **Registry** | Serviço de discovery. Agentes se registram aqui, consultam quem está online, atualizam status. |
| **Agent** | Unidade de trabalho. Cada agente tem um role, capabilities, e se comunica diretamente com outros agentes. |

### Conceitos

| Conceito | Descrição |
|----------|-----------|
| **Role** | Template de cargo (ex: "Product Manager", "Frontend Developer"). Define system prompt, capabilities, e comportamento. |
| **Agent** | Instância de um Role. Processo rodando, com endpoint HTTP próprio. Pode haver múltiplos agentes do mesmo Role. |
| **Task** | Unidade de trabalho com título, descrição, prioridade, owner, e status. |
| **Message** | Comunicação entre agentes: tasks, perguntas, respostas, handoffs. |

## Fluxo de Trabalho

```
1. Humano manda demanda → Manager (POST /tasks)
2. Manager consulta Registry → encontra o PM
3. Manager delega pro PM (HTTP direto)
4. PM quebra em subtasks → consulta Registry → encontra devs
5. PM envia tasks diretamente pros devs (P2P)
6. Devs trabalham, atualizam status no Registry
7. Devs terminam → handoff pro QA
8. QA valida → handoff pro SRE
9. SRE deploya → notifica PM
10. PM fecha a demanda → Manager atualiza status
```

## Stack Técnica

| Categoria | Tecnologia |
|-----------|------------|
| Runtime | Node.js 22 |
| Linguagem | TypeScript 5 |
| Monorepo | pnpm workspaces |
| HTTP Framework | Hono |
| Validação | Zod |
| Banco de Dados | PostgreSQL |
| ORM | Drizzle |
| LLM SDK | Vercel AI SDK |
| Logs | Pino |
| Build | tsup |
| Test | Vitest |
| Container | Docker + Compose |

## Estrutura do Projeto

```
hivemi/
├── docker-compose.yml       # Orquestração local
├── packages/
│   ├── protocol/            # Tipos e schemas compartilhados
│   ├── registry/            # Microserviço de discovery
│   ├── manager/             # API externa + dashboard
│   └── agent/               # Lib base para criar agentes
├── agents/                  # Implementações de agentes
│   ├── pm/                  # Product Manager
│   ├── techlead/            # Tech Lead
│   └── dev/                 # Developer
└── docs/                    # Documentação adicional
```

## Protocolo de Comunicação

### Registro de Agente

Ao iniciar, cada agente se registra no Registry:

```http
POST /agents
Authorization: Bearer {shared_secret}
Content-Type: application/json

{
  "id": "pm-1",
  "role": "product-manager",
  "endpoint": "http://localhost:3001",
  "capabilities": ["break-down-tasks", "prioritize", "user-stories"]
}
```

### Mensagem entre Agentes

Comunicação direta P2P:

```http
POST /message
Authorization: Bearer {shared_secret}
Content-Type: application/json

{
  "id": "msg-uuid",
  "from": "pm-1",
  "type": "task",
  "payload": {
    "title": "Implementar tela de login",
    "description": "...",
    "priority": "high",
    "context": { ... }
  },
  "timestamp": 1707280000
}
```

### Tipos de Mensagem

| Tipo | Descrição |
|------|-----------|
| `task` | Atribuição de tarefa |
| `question` | Pergunta para outro agente |
| `response` | Resposta a uma pergunta |
| `status` | Atualização de status |
| `handoff` | Passagem de responsabilidade |

## Autenticação

Modelo simples com shared secret:

- Todos os agentes recebem o mesmo `HIVEMI_SECRET` ao iniciar
- Toda comunicação (Registry, P2P) inclui header `Authorization: Bearer {secret}`
- Registry valida antes de aceitar registros/atualizações
- Agentes validam antes de processar mensagens

## Quick Start

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/hivemi.git
cd hivemi

# Instale dependências
pnpm install

# Suba a infraestrutura
docker-compose up -d postgres

# Configure variáveis
cp .env.example .env

# Rode as migrations
pnpm db:migrate

# Inicie o Registry
pnpm --filter registry dev

# Inicie o Manager
pnpm --filter manager dev

# Inicie um agente
pnpm --filter agent-pm dev
```

## Roadmap

- [x] Definição de arquitetura
- [ ] Protocol package (tipos e schemas)
- [ ] Registry service
- [ ] Manager service
- [ ] Agent base lib
- [ ] PM agent
- [ ] Tech Lead agent
- [ ] Developer agent
- [ ] Dashboard web
- [ ] Métricas e observabilidade

## Licença

MIT
