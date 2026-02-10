# HiveMI — Plano de Simplificação

_Criado: 2026-02-10 · Autor: Clawdia 🦞_

> Objetivo: reduzir complexidade sem perder funcionalidade real. Cortar código morto, eliminar camadas desnecessárias, consolidar packages.

---

## Resumo

| Métrica | Antes | Depois (estimado) |
|---------|-------|--------------------|
| Apps | 3 (dashboard, manager, registry) | 2 (dashboard, registry) |
| Packages | 7 | 4 |
| API proxy layers | 2 (dashboard → manager → registry) | 1 (dashboard → registry) |
| Dashboard API route files | 35+ | 1 (proxy genérico) |
| LOC estimado removido | — | ~3.000-4.000 |

---

## Fase 1: Eliminar o Manager como Serviço Separado

**Problema:** O Manager (:4000) é 80% proxy pro Registry e 20% lógica real. Das ~20 rotas, só 3 fazem algo único:
- `POST /api/deploy` → DeployOrchestrator (a única lógica substancial: 917 LOC)
- `POST /api/demands` → cria task + tenta assignment
- `GET /api/infra/*` → reconciliation + costs (chama Provisioner)

Tudo mais (`/api/agents`, `/api/roles`, `/api/teams`, `/api/status`) é proxy pro Registry.

**Solução:** Mover a lógica real pra dentro do Registry:
1. **DeployOrchestrator** → nova rota no Registry (`/api/deploys/orchestrate`) ou módulo interno
2. **Demands** → lógica de auto-assignment direto na criação de tasks no Registry
3. **Infra routes** → mover pro Registry (já tem acesso ao DB e pode chamar Provisioner)

**Resultado:** Matar `apps/manager/` inteiro (~2.000 LOC). Dashboard faz proxy direto pro Registry.

**Risco:** Médio. O DeployOrchestrator é complexo e depende de Provisioner + Bootstrapper. Precisa testar bem.

**Ordem:**
1. Copiar `deploy-orchestrator.ts` + `registry-client.ts` pro Registry
2. Criar rotas de deploy no Registry (ou expandir as existentes)
3. Mover demands logic pro Registry
4. Mover infra routes pro Registry
5. Atualizar Dashboard proxy pra apontar só pro Registry
6. Remover `apps/manager/`
7. Remover do PM2

---

## Fase 2: Simplificar Dashboard API Proxy

**Problema:** 35+ arquivos em `apps/dashboard/src/app/api/` que fazem basicamente a mesma coisa:

```typescript
// Cada arquivo é ~20 linhas desse padrão:
export async function GET(req) {
  const res = await fetch(`${REGISTRY_URL}/api/agents`);
  return Response.json(await res.json());
}
```

**Solução:** Um único middleware/catch-all route que faz proxy genérico:

```typescript
// apps/dashboard/src/app/api/[...path]/route.ts
export async function handler(req, { params }) {
  const path = params.path.join('/');
  const url = `${REGISTRY_URL}/api/${path}`;
  return fetch(url, { method: req.method, body: req.body, headers: ... });
}
export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
```

**Resultado:** 35+ arquivos → 1 arquivo. Qualquer endpoint novo no Registry é automaticamente acessível pelo Dashboard.

**Exceções:** Rotas que fazem lógica extra (ex: SSE streaming do deploy) precisam de arquivos dedicados. Estimar 2-3 exceções max.

**Risco:** Baixo. É refactor mecânico. Os testes Playwright validam que tudo continua funcionando.

---

## Fase 3: Consolidar Packages

### 3A. Absorver `agent-runtime` no `protocol`

**Problema:** `agent-runtime` tem 249 LOC — um logger e types. Não justifica um package separado.

**Solução:** Mover o conteúdo pra `protocol` (que já é o package compartilhado central). O daemon importa de `@hivemi/protocol` em vez de `@hivemi/agent-runtime`.

**Resultado:** -1 package, zero perda de funcionalidade.

**Risco:** Baixíssimo. Só mudar imports.

### 3B. Remover `llm`

**Problema:** Package quase vazio. Agents usam OpenClaw que já abstrai LLMs. A abstração de LLM provider no HiveMI é redundante.

**Solução:** Deletar `packages/llm/`. Se algum código depende dele, mover pro `protocol` ou `daemon`.

**Resultado:** -1 package.

**Risco:** Baixíssimo. Verificar se algo importa dele (provavelmente não).

### 3C. Avaliar `cli`

**Problema:** 344 LOC, raramente mencionado. Funciona?

**Ação:** Não deletar ainda, mas marcar como `deprecated` ou `experimental`. Reavaliar depois que o sistema core estiver estável.

**Risco:** Nenhum (não é ação destrutiva).

### Resultado da Fase 3:
- **Antes:** protocol, agent-daemon, provisioner, bootstrapper, agent-runtime, cli, llm (7)
- **Depois:** protocol, agent-daemon, provisioner, bootstrapper, cli (5, sendo cli deprecated)
- **Efetivo:** 4 packages ativos

---

## Fase 4: Limpar Código Morto / YAGNI

### 4A. Remover GCP Provider Stub

**Problema:** `packages/provisioner/src/providers/gcp.ts` — 82 LOC de stub que não faz nada. Só ocupa espaço e cria ilusão de suporte multi-cloud.

**Solução:** Deletar. Quando precisar de GCP, implementa de verdade.

**Risco:** Zero.

### 4B. Avaliar P2P Agent Communication

**Problema:** ~700 LOC entre `p2p-client.ts` e `p2p-handler.ts` no daemon. Feature complexa que permite agents se comunicarem diretamente na VPC. Mas nenhum fluxo do sistema usa isso ativamente — tasks são distribuídas via Registry polling.

**Solução:** Não deletar (é feature legítima futura), mas isolar:
1. Mover pra um módulo separado dentro do daemon (`src/p2p/`)
2. Tornar opt-in via config flag (`p2p.enabled: false` por default)
3. Não carregar se desabilitado (menos memoria, menos conexões)

**Risco:** Baixo. Isola sem destruir.

### 4C. Remover Task Progress Table do Schema Ativo

**Problema:** Tabela `task_progress` criada no DB mas marcada como "Phase 2 #68". Nenhum endpoint usa, nenhum código escreve nela.

**Solução:** Manter no schema mas adicionar comentário claro de que é placeholder. Ou mover pra um arquivo `schema-future.ts` separado.

**Risco:** Zero.

### 4D. Eliminar Mock Data Files

**Problema:** `apps/dashboard/src/data/mock-*.ts` (4 arquivos) provavelmente não são mais usados agora que tudo vem do backend real.

**Solução:** Verificar se algum import referencia. Se não, deletar.

**Risco:** Baixíssimo.

### 4E. Unificar Types do Dashboard

**Problema:** `apps/dashboard/src/types/` (agent.ts, role.ts, task.ts, log.ts) duplicam definições que já existem no `protocol`. Dashboard deveria importar de `@hivemi/protocol`.

**Solução:** Substituir types locais por imports do protocol. Pode precisar de ajustes menores nos tipos (frontend vs backend shapes).

**Risco:** Baixo-médio. Alguns tipos do frontend podem ter campos diferentes (ex: campos computados, campos opcionais no frontend).

---

## Fase 5: Registry — Completar Rotas Faltantes

**Problema identificado nos testes:** Registry não tem `PUT /api/teams/:id` nem `DELETE /api/teams/:id`. Dashboard faz proxy mas dá 404.

**Solução:** Implementar CRUD completo pra teams no Registry, seguindo o mesmo padrão de roles.

**Risco:** Baixíssimo. Código boilerplate.

---

## Ordem de Execução Recomendada

```
Fase 5 → Fase 4D/4A → Fase 3 → Fase 2 → Fase 1 → Fase 4B/4C/4E
```

**Por quê essa ordem:**
1. **Fase 5** primeiro porque é bug fix (teams CRUD incompleto)
2. **Fase 4D/4A** são quick wins sem risco (deletar mock data e GCP stub)
3. **Fase 3** é mecânico (consolidar packages, mudar imports)
4. **Fase 2** é refactor do proxy (1 arquivo substitui 35+)
5. **Fase 1** é a maior mudança (eliminar Manager) — fazer por último quando o resto já tá limpo
6. **Fase 4B/4C/4E** são melhorias que podem esperar

---

## Estimativa de Esforço

| Fase | Esforço | Impacto | LOC Removido |
|------|---------|---------|--------------|
| 1. Eliminar Manager | Alto (1-2 dias) | 🔴 Alto | ~2.000 |
| 2. Simplificar Proxy | Médio (2-4h) | 🟡 Médio | ~700 |
| 3. Consolidar Packages | Baixo (1-2h) | 🟡 Médio | ~300 |
| 4A. GCP stub | Trivial (5min) | 🟢 Baixo | ~80 |
| 4B. Isolar P2P | Baixo (1h) | 🟢 Baixo | 0 (reorganiza) |
| 4C. Task Progress | Trivial (5min) | 🟢 Baixo | 0 (comenta) |
| 4D. Mock data | Trivial (15min) | 🟢 Baixo | ~200 |
| 4E. Unificar types | Médio (2-3h) | 🟡 Médio | ~150 |
| 5. Teams CRUD | Baixo (30min) | 🟢 Baixo | 0 (adiciona ~50) |
| **Total** | **~2-3 dias** | | **~3.400 LOC** |

---

## O Que NÃO Simplificar

- ✅ **Registry** — tá bem, é o core
- ✅ **Protocol** — schemas centralizados é o jeito certo
- ✅ **Provisioner** — lógica real de cloud, reconciliation é essencial
- ✅ **Bootstrapper** — setup de VMs é complexo por natureza
- ✅ **Agent Daemon** — coração do sistema nos VMs
- ✅ **Deploy pipeline** — as 5 fases fazem sentido
- ✅ **Pull model de tasks** — simples e robusto
- ✅ **Testes Playwright** — 122 testes é um asset, não complexidade

---

_"Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away." — Saint-Exupéry_
