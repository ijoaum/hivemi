# HiveMI Dashboard — Form & CRUD Test Scenarios

> Cenários de teste focados em formulários, validação, submissão e integração com API.
> Complementa `TEST_SCENARIOS.md` que cobre navegação e layout.
> Criado por Clawdia 🦞 em 2026-02-10.

---

## 📋 Índice

- [1. Deploy Agent Modal (Form)](#1-deploy-agent-modal-form)
- [2. Create Role Modal (Form)](#2-create-role-modal-form)
- [3. Edit Role Modal (Form)](#3-edit-role-modal-form)
- [4. Create Team Modal (Form)](#4-create-team-modal-form)
- [5. Edit Team Modal (Form)](#5-edit-team-modal-form)
- [6. Create Task Modal (Form)](#6-create-task-modal-form)
- [7. Agent CRUD Operations](#7-agent-crud-operations)
- [8. Agent Detail Page Actions](#8-agent-detail-page-actions)
- [9. Task Actions](#9-task-actions)
- [10. Settings Page Forms](#10-settings-page-forms)
- [11. Infrastructure Actions](#11-infrastructure-actions)
- [12. Form Validation (Cross-cutting)](#12-form-validation-cross-cutting)
- [13. API Error Handling](#13-api-error-handling)
- [14. Data Integrity & Relationships](#14-data-integrity--relationships)
- [15. Concurrent Operations](#15-concurrent-operations)

---

## 1. Deploy Agent Modal (Form)

### Fields: name (text), role (dropdown), team (select), model (radio grid), autoStart (toggle)

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| DAM-01 | Modal abre com defaults | Clicar "Deploy Agent" | Modal abre. Name preenchido com nome random. Role = primeiro da lista. Team = primeiro da lista. Model = gpt-4o. Auto-start = ON | Alta |
| DAM-02 | Random name button | Clicar ícone de dado (Dices) | Nome muda para outro nome aleatório da lista | Média |
| DAM-03 | Name field editável | Limpar nome, digitar "TestAgent-01" | Campo aceita o texto, botão Deploy habilitado | Alta |
| DAM-04 | Name vazio bloqueia submit | Limpar campo name completamente | Botão "Deploy Agent" fica desabilitado (bg-gray-700, cursor-not-allowed) | Alta |
| DAM-05 | Role dropdown abre | Clicar no botão de Role | Dropdown expande mostrando todas as roles com icon + name + description | Alta |
| DAM-06 | Role dropdown - selecionar | Abrir dropdown → clicar em uma role | Dropdown fecha, role selecionada aparece no botão com icon correto | Alta |
| DAM-07 | Role dropdown - click outside | Abrir dropdown → clicar fora | Dropdown fecha sem mudar seleção | Média |
| DAM-08 | Role dropdown - highlight | Abrir dropdown | Role atualmente selecionada tem bg amber (bg-amber-500/20) | Baixa |
| DAM-09 | Team select | Mudar team no select | Valor atualiza, todas as teams disponíveis aparecem como options | Alta |
| DAM-10 | Model selection grid | Clicar em cada model button | Model selecionado fica com border amber, os outros ficam cinza | Alta |
| DAM-11 | Todos os models listados | Verificar grid de models | 4 models: GPT-4o (OpenAI), Claude Sonnet 4 (Anthropic), Claude Opus 4 (Anthropic), Gemini 2.5 Flash (Google) | Alta |
| DAM-12 | Auto-start toggle | Clicar no toggle | Toggle alterna entre amber (on) e gray (off), bolinha desliza | Média |
| DAM-13 | Submit com dados válidos | Preencher tudo → clicar Deploy | Estado muda pra "Deploying..." com Loader2 spinning, API chamada com POST /api/agents | Alta |
| DAM-14 | Submit sucesso | Submeter com API retornando sucesso | Overlay verde com CheckCircle + "Agent Deployed!" + nome. Modal fecha automaticamente após 1.5s | Alta |
| DAM-15 | Submit erro da API | Submeter com API retornando erro | Banner vermelho com AlertCircle + mensagem de erro. Modal permanece aberta. Formulário re-habilitado | Alta |
| DAM-16 | Campos desabilitados durante deploy | Submeter formulário | Todos os campos (input, dropdown, select, buttons, toggle) ficam com opacity-50 e disabled | Média |
| DAM-17 | Cancel fecha modal | Clicar "Cancel" | Modal fecha, nenhuma API chamada | Alta |
| DAM-18 | Backdrop fecha modal | Clicar na área escura atrás do modal | Modal fecha (exceto durante deploying) | Média |
| DAM-19 | Backdrop não fecha durante deploy | Iniciar deploy → clicar backdrop | Modal NÃO fecha enquanto está deployando | Média |
| DAM-20 | Reset após sucesso | Deploy com sucesso → modal fecha → reabrir modal | Nome é um novo random, estado volta a "idle", sem mensagem de erro | Alta |
| DAM-21 | Payload da API correto | Submeter com name="Atlas", role=PM, team=Alpha, model=claude-sonnet-4, autoStart=true | POST /api/agents com body: { name: "Atlas", roleId: "<pm-id>", teamId: "<alpha-id>", model: "claude-sonnet-4", host: "http://localhost", port: <random 3001-3100>, status: "idle" } | Alta |
| DAM-22 | Payload com autoStart=false | Submeter com autoStart desligado | POST /api/agents com status: "offline" em vez de "idle" | Alta |
| DAM-23 | Sem roles disponíveis | Abrir modal quando API roles retorna [] | Dropdown mostra "Select a role" sem opções. Submit bloqueado | Média |
| DAM-24 | Sem teams disponíveis | Abrir modal quando API teams retorna [] | Select vazio. Submit bloqueado pois teamId é vazio | Média |
| DAM-25 | Nome com caracteres especiais | Digitar "Agent @#$% 123" | Campo aceita (sem validação client-side), API decide se aceita | Baixa |
| DAM-26 | Nome muito longo | Digitar nome com 200+ caracteres | Campo aceita, testar se API rejeita ou trunca | Baixa |

---

## 2. Create Role Modal (Form)

### Fields: name, slug (auto-gen), description, icon (grid), color (grid), capabilities (text), systemPrompt (textarea)

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| CRM-01 | Modal abre em branco | Clicar "Create Role" | Todos os campos vazios. Icon default = "bot". Color default = "blue" | Alta |
| CRM-02 | Auto-slug do name | Digitar "Tech Lead" no name | Slug auto-preenche com "tech-lead" | Alta |
| CRM-03 | Auto-slug com caracteres especiais | Digitar "QA & Testing!" no name | Slug gera "qa-testing" (remove &, !, espaços → hifens) | Alta |
| CRM-04 | Slug editável manualmente | Editar slug pra "custom-slug" | Auto-slug desativa, slug fica fixo mesmo mudando name | Alta |
| CRM-05 | Name required | Tentar submeter sem name | Submit bloqueado (botão desabilitado) | Alta |
| CRM-06 | Slug required | Limpar slug | Submit bloqueado | Alta |
| CRM-07 | Description required | Tentar submeter sem description | Submit bloqueado | Alta |
| CRM-08 | SystemPrompt required | Tentar submeter sem systemPrompt | Submit bloqueado | Alta |
| CRM-09 | Icon selection | Clicar em cada ícone disponível | Ícone selecionado fica com border amber, anterior perde destaque | Alta |
| CRM-10 | Todos os ícones renderizam | Verificar grid de ícones | Todos os ícones do iconMap renderizam sem erro | Média |
| CRM-11 | Color selection | Clicar em cada cor | Cor selecionada fica com border white + scale-110, anterior volta ao normal | Alta |
| CRM-12 | Todas as 8 cores disponíveis | Verificar grid de cores | blue, purple, cyan, green, amber, red, pink, indigo | Média |
| CRM-13 | Capabilities parsing | Digitar "code-review, testing, CI/CD" | Ao submeter, envia array ["code-review", "testing", "CI/CD"] | Alta |
| CRM-14 | Capabilities vazio é válido | Deixar capabilities em branco | Submit funciona, envia array vazio [] | Média |
| CRM-15 | Submit sucesso | Preencher todos required → salvar | Loading state (Loader2 + "Saving..."), API chamada POST /api/roles, modal fecha | Alta |
| CRM-16 | Submit erro | API retorna erro | Modal permanece aberta (try/finally sem catch explícito — verificar UX) | Alta |
| CRM-17 | Cancel fecha sem salvar | Preencher dados → Cancel | Modal fecha, nenhuma API chamada, dados não salvos | Alta |
| CRM-18 | Backdrop fecha | Clicar fora do modal | Modal fecha | Média |
| CRM-19 | Payload correto | Submeter com todos os campos | POST /api/roles com { name, slug, description, icon, color, capabilities: [], systemPrompt } | Alta |
| CRM-20 | SystemPrompt com quebras de linha | Digitar prompt multi-linha | Textarea aceita e envia corretamente | Média |

---

## 3. Edit Role Modal (Form)

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| ERM-01 | Modal abre com dados preenchidos | Clicar "Edit" em uma role existente | Todos os campos preenchidos com dados da role. Auto-slug desativado | Alta |
| ERM-02 | Icon pré-selecionado | Abrir edit modal | Ícone da role está com border amber | Alta |
| ERM-03 | Color pré-selecionada | Abrir edit modal | Cor da role está com border white + scale-110 | Alta |
| ERM-04 | Capabilities pré-preenchidas | Abrir edit modal de role com capabilities | Campo mostra "cap1, cap2, cap3" (join com vírgula) | Alta |
| ERM-05 | Alterar name não altera slug | Mudar name em edit mode | Slug NÃO muda (auto-slug desativado no edit) | Alta |
| ERM-06 | Submit atualiza | Mudar description → salvar | PUT /api/roles/{id} chamada com dados atualizados | Alta |
| ERM-07 | Lista atualiza após edit | Salvar edição com sucesso | Card da role na lista reflete as mudanças imediatamente | Alta |

---

## 4. Create Team Modal (Form)

### Fields: name, icon (grid), color (grid)

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| CTM-01 | Modal abre em branco | Clicar "Create Team" | Name vazio. Icon default = "blocks". Color default = "blue" | Alta |
| CTM-02 | Name required | Tentar submeter sem name | Submit bloqueado (botão desabilitado) | Alta |
| CTM-03 | Icon selection | Clicar em diferentes ícones | Ícone selecionado fica com border amber | Alta |
| CTM-04 | Color selection | Clicar em diferentes cores | Cor selecionada fica com border white + scale-110 | Alta |
| CTM-05 | Submit sucesso | Preencher name + ícone + cor → salvar | POST /api/teams com { name, emoji: iconName, color }. Modal fecha | Alta |
| CTM-06 | Payload usa "emoji" pro ícone | Submeter | Body contém `emoji: "rocket"` (não `icon`) | Alta |
| CTM-07 | Lista atualiza após criação | Criar team com sucesso | Nova team aparece na lista de teams | Alta |
| CTM-08 | Cancel não salva | Preencher → Cancel | Modal fecha sem API call | Média |
| CTM-09 | Nome duplicado | Criar team com mesmo nome de uma existente | Verificar se API aceita ou rejeita (sem validação client-side) | Média |

---

## 5. Edit Team Modal (Form)

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| ETM-01 | Modal abre com dados | Clicar "Edit" em team existente | Name, icon e color preenchidos com valores atuais | Alta |
| ETM-02 | Alterar nome | Mudar nome → salvar | PUT /api/teams/{id} com novo nome | Alta |
| ETM-03 | Alterar cor | Mudar cor → salvar | PUT /api/teams/{id} com nova cor. Card atualiza visualmente | Alta |
| ETM-04 | Lista atualiza | Salvar edição | Team card reflete mudanças. Home page também reflete (agent groups) | Alta |

---

## 6. Create Task Modal (Form)

### Fields: title, description, team (select), priority (3 buttons), input (textarea)

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| CKM-01 | Modal abre em branco | Clicar "Create Task" | Title vazio, description vazio, team = "Select a team...", priority = medium, input vazio | Alta |
| CKM-02 | Title required | Tentar submeter sem title | Submit bloqueado | Alta |
| CKM-03 | Team required | Tentar submeter sem selecionar team | Submit bloqueado (teamId é vazio) | Alta |
| CKM-04 | Description opcional | Submeter sem description | Submit funciona, description enviada como undefined | Alta |
| CKM-05 | Input data opcional | Submeter sem input | Submit funciona, input enviada como undefined | Alta |
| CKM-06 | Priority buttons | Clicar em each: low, medium, high | Botão selecionado muda de cor (gray/amber/red), anteriores voltam ao normal | Alta |
| CKM-07 | Priority default = medium | Abrir modal | Botão "medium" já está selecionado (amber) | Alta |
| CKM-08 | Submit via demands API | Submeter formulário | POST /api/demands (NÃO /api/tasks!) com { title, description, priority, teamId, input } | Alta |
| CKM-09 | Submit sucesso | API retorna sucesso | Modal fecha, formulário reseta, callback onCreated chamado | Alta |
| CKM-10 | Submit erro | API retorna erro | Banner vermelho com mensagem de erro. Modal permanece aberta | Alta |
| CKM-11 | Loading state durante submit | Submeter formulário | Botão muda pra "Creating...", campos permanecem (não desabilitam — verificar se deveriam) | Média |
| CKM-12 | Form reseta após sucesso | Criar task → reabrir modal | Todos os campos estão limpos/default | Alta |
| CKM-13 | Input textarea monospace | Verificar campo input | Font é monospace (font-mono), text-sm | Baixa |
| CKM-14 | Title com apenas espaços | Digitar "   " no title | Submit bloqueado (trim() resulta em vazio) | Alta |
| CKM-15 | Todas as teams no select | Verificar select de teams | Todas as teams da API aparecem como options | Alta |

---

## 7. Agent CRUD Operations

### End-to-end: criar, visualizar, atualizar status, deletar

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| ACR-01 | Criar agent - full flow | Deploy Agent → preencher → submeter | Agent aparece na home dentro do team correto, com status idle (autoStart=true) | Alta |
| ACR-02 | Criar agent - offline | Deploy com autoStart=false | Agent aparece com status offline (dot cinza) | Alta |
| ACR-03 | Start agent | Agent offline → menu → Start | PUT /api/agents/{id} com { status: "idle" }. Dot muda pra verde | Alta |
| ACR-04 | Stop agent - confirm | Agent online → menu → Stop | ConfirmDialog aparece com mensagem de stop | Alta |
| ACR-05 | Stop agent - execute | Confirmar stop | PUT /api/agents/{id} com { status: "offline" }. Dot muda pra cinza | Alta |
| ACR-06 | Stop agent - cancel | ConfirmDialog → Cancel | Dialog fecha, agent permanece online | Alta |
| ACR-07 | Restart agent - confirm | Agent online → menu → Restart | ConfirmDialog aparece com mensagem de restart | Alta |
| ACR-08 | Restart agent - execute | Confirmar restart | PUT offline → delay 500ms → PUT idle. Agent volta a ficar online | Alta |
| ACR-09 | Delete agent - confirm | Agent → menu → Delete/Destroy | ConfirmDialog aparece com isDestructive (botão vermelho) | Alta |
| ACR-10 | Delete agent - execute | Confirmar delete | DELETE /api/agents/{id}. Agent desaparece da lista | Alta |
| ACR-11 | Delete agent - cancel | ConfirmDialog → Cancel | Dialog fecha, agent permanece | Alta |
| ACR-12 | Agent com deploy - destroy | Agent com deployId → Destroy | Chama deployApi.destroy(deployId) em vez de agentsApi.delete | Alta |
| ACR-13 | Agent working - force destroy | Destroy agent working → API retorna "currently working" | Segundo dialog "Force Destroy" aparece com aviso sobre task ativa | Alta |
| ACR-14 | Force destroy executa | Confirmar force destroy | deployApi.destroy(id, force=true). Agent destruído, redirect pra home | Alta |
| ACR-15 | Lista auto-refresh | Criar/deletar agent | Lista atualiza via refetchAgents() após cada operação | Alta |

---

## 8. Agent Detail Page Actions

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| ADP-01 | Navegar pra agent detail | Clicar no nome de um agent | URL muda pra /agents/{id}, página de detalhes carrega | Alta |
| ADP-02 | Info renderiza | Abrir agent detail | Nome, status dot, role name, team name, model, endpoint, heartbeat, created date | Alta |
| ADP-03 | Back button | Clicar seta ← | Volta pra home (/) | Alta |
| ADP-04 | Start button (offline) | Agent offline | Botão verde "Start" visível, sem botão Stop | Alta |
| ADP-05 | Stop button (online) | Agent online | Botão "Stop" visível, sem botão Start | Alta |
| ADP-06 | More actions menu | Clicar ⋮ | Dropdown com Restart (disabled se offline) e Destroy | Alta |
| ADP-07 | Menu click outside | Abrir menu → clicar fora | Menu fecha | Média |
| ADP-08 | Restart disabled quando offline | Agent offline → abrir menu | Botão Restart tem opacity-30 e cursor-not-allowed | Média |
| ADP-09 | Stats cards | Verificar stats | 4 cards: Total Tasks, Completed, Failed, Active com contagens corretas | Alta |
| ADP-10 | Recent tasks lista | Agent com tasks | Últimas 5 tasks aparecem com title, date e status badge | Alta |
| ADP-11 | Recent logs lista | Agent com logs | Últimos 10 logs em formato monospace com timestamp, level, message | Alta |
| ADP-12 | Sidebar config info | Verificar sidebar | ID (monospace), Model, Endpoint, Last Heartbeat, Created | Alta |
| ADP-13 | Role info sidebar | Agent com role | Card com ícone, nome, description, capabilities badges | Alta |
| ADP-14 | Agent not found | Navegar pra ID inválido | Mensagem "Agent not found" com botão "Back to Dashboard" | Alta |
| ADP-15 | Destroyed agent - sem ações | Agent com status "destroyed" | Botões de ação (Start, Stop, menu) não aparecem | Média |
| ADP-16 | Auto-refresh | Esperar 5 segundos | Dados do agent, tasks e logs atualizam automaticamente | Média |

---

## 9. Task Actions

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| TKA-01 | Task detail modal | Clicar em uma task | Modal abre com title, status badge, priority badge, description, timestamps | Alta |
| TKA-02 | Retry task | Task failed → clicar Retry | POST /api/tasks/{id}/retry. Status muda pra queued | Alta |
| TKA-03 | Cancel task | Task queued/locked → clicar Cancel | POST /api/tasks/{id}/cancel. Status muda | Alta |
| TKA-04 | Task filters - status | Selecionar filtro "completed" | Só tasks com status completed aparecem | Alta |
| TKA-05 | Task filters - team | Selecionar filtro por team | Só tasks daquele team aparecem | Alta |
| TKA-06 | Task filters - combinados | Selecionar status + team | Ambos filtros aplicados simultaneamente | Alta |
| TKA-07 | Task auto-refresh | Esperar 5 segundos | Lista de tasks atualiza automaticamente | Média |
| TKA-08 | Task timestamps | Verificar task detail | createdAt, startedAt (se iniciada), completedAt (se completa) formatados | Média |
| TKA-09 | Task error display | Task failed com error | Campo de erro visível no detail modal | Alta |
| TKA-10 | Task input/output | Task com input e output | Campos exibidos no detail modal em formato monospace | Média |

---

## 10. Settings Page Forms

### Cada seção de settings tem campos editáveis

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| SET-01 | General - Cluster Name | Editar campo "Cluster Name" | Campo aceita novo valor (state local, não persiste na API ainda) | Alta |
| SET-02 | General - Registry URL disabled | Verificar campo Registry URL | Campo disabled, valor "http://localhost:4001", não editável | Média |
| SET-03 | General - Auto-start toggle | Clicar toggle | Alterna entre on/off visualmente | Média |
| SET-04 | General - Debug mode toggle | Clicar toggle | Alterna entre on/off visualmente | Média |
| SET-05 | Agent Settings - Max Concurrent | Editar campo numérico | Aceita apenas números | Alta |
| SET-06 | Agent Settings - Heartbeat Interval | Editar campo | Aceita número em segundos | Alta |
| SET-07 | Agent Settings - Task Timeout | Editar campo | Aceita número em segundos | Alta |
| SET-08 | LLM - Default Provider select | Mudar provider no select | Seleciona entre OpenAI e Anthropic | Alta |
| SET-09 | LLM - Providers listados | Verificar lista | 3 providers: OpenAI (connected), Anthropic (connected), Google (not configured) | Alta |
| SET-10 | LLM - Status badges | Verificar badges | "Connected" = verde, "Not Configured" = cinza | Média |
| SET-11 | Secrets - Lista | Verificar lista de secrets | 4 secrets: OPENAI_API_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN, DATABASE_URL | Alta |
| SET-12 | Secrets - Source info | Verificar cada secret | Source (1Password ou Environment) e lastUpdated visíveis | Média |
| SET-13 | Secrets - Rotate button | Verificar botão | Botão "Rotate" amber em cada secret | Média |
| SET-14 | Secrets - Add button | Verificar botão | Botão "+ Add Secret" com border dashed | Média |
| SET-15 | Secrets - 1Password status | Verificar card de integração | Mostra "Service Account", "Vault: Clawdia", badge "Connected" | Média |
| SET-16 | Notifications - toggles | Clicar cada toggle | Task completed, Task failed, Agent offline, Daily digest alternam corretamente | Média |
| SET-17 | Danger - Reset Cluster | Verificar botão | Botão vermelho "Reset Cluster" com texto explicativo | Alta |
| SET-18 | Danger - Delete Everything | Verificar botão | Botão vermelho "Delete Everything" com texto explicativo | Alta |
| SET-19 | Settings nav - todas as seções | Clicar em cada seção | Conteúdo muda: General, Infrastructure, Agents, LLM Providers, Secrets, Notifications, Danger Zone | Alta |
| SET-20 | Settings nav - seção ativa | Clicar seção | Seção ativa fica com bg-gray-800 text-white, inativas text-gray-400 | Média |
| SET-21 | Infra - Reconciliation | Verificar card | Stats (Total VMs, Healthy, Orphaned, Phantom), status badge, issues list, botão "Reconcile" | Alta |
| SET-22 | Infra - Costs | Verificar card | Monthly, Projected, Accumulated costs. Per-instance breakdown | Alta |
| SET-23 | Infra - Destroy orphan | Clicar "Destroy" em VM órfã | Confirm prompt, DELETE /api/infra/reconcile/orphan/{instanceId} | Alta |
| SET-24 | Infra - Reconcile refresh | Clicar "Reconcile" | Dados atualizam via refetch | Média |

---

## 11. Infrastructure Actions

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| INF-01 | Reconciliation loading | Abrir Settings > Infrastructure | Loading state "Running reconciliation..." com animate-pulse | Média |
| INF-02 | Reconciliation - clean | API retorna status "clean" | Badge verde "✓ Healthy", sem issues | Alta |
| INF-03 | Reconciliation - warning | API retorna issues tipo warning | Badge amber "⚠ Issues", issues listadas | Alta |
| INF-04 | Reconciliation - critical | API retorna issues tipo error | Badge vermelho "✗ Critical", issues com bg-red | Alta |
| INF-05 | Cost - sem VMs | Sem VMs ativas | Mensagem "No active VMs. Deploy an agent to see cost estimates." | Média |
| INF-06 | Cost - breakdown | VMs ativas | Lista de instâncias com name, size, days running, monthly cost, accumulated | Alta |
| INF-07 | Cloud não configurado | API de infra falha | Mensagem "Could not load reconciliation data. Is the cloud provider configured?" | Alta |

---

## 12. Form Validation (Cross-cutting)

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| VAL-01 | Deploy Agent - required fields | Limpar name, tentar submit | Botão disabled. Condição: !name \|\| !roleId \|\| !teamId | Alta |
| VAL-02 | Create Role - all required | Verificar condição de submit | Precisa: name AND slug AND description AND systemPrompt | Alta |
| VAL-03 | Create Team - name required | Verificar condição de submit | Precisa: name preenchido | Alta |
| VAL-04 | Create Task - required combo | Verificar condição | Precisa: title.trim() não vazio AND teamId selecionado | Alta |
| VAL-05 | HTML5 required attribute | Verificar forms | Campos com `required` HTML5 (name no deploy, name+slug+description+systemPrompt na role, name no team, title no task) | Média |
| VAL-06 | Campos numéricos em Settings | Digitar letras nos campos de número | type="number" impede letras nativamente | Média |
| VAL-07 | Textarea resize | Verificar textareas | Description e SystemPrompt na role têm resize-none. Input no task também | Baixa |
| VAL-08 | Placeholder text | Verificar todos os campos | Cada campo tem placeholder descritivo e útil | Baixa |

---

## 13. API Error Handling

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| ERR-01 | Registry offline - agents | Registry down → abrir dashboard | Home mostra loading → erro (ou lista vazia dependendo do fallback) | Alta |
| ERR-02 | Registry offline - deploy | Registry down → tentar deploy agent | Modal mostra error banner com "Registry unavailable" (502) | Alta |
| ERR-03 | Registry offline - roles | Registry down → abrir Roles | Lista vazia (fallback) | Alta |
| ERR-04 | Registry offline - teams | Registry down → abrir Teams | Lista vazia (fallback) | Alta |
| ERR-05 | Registry offline - tasks | Registry down → abrir Tasks | Lista vazia (fallback) | Alta |
| ERR-06 | API validation error | Enviar dados inválidos via API | Mensagem de erro da API exibida no modal/banner | Alta |
| ERR-07 | API campo obrigatório faltando | Frontend envia sem campo que API requer | Erro "missing required field: X" exibido no frontend | Alta |
| ERR-08 | Network timeout | Conexão lenta/timeout | Formulário não trava — loading state eventual, erro exibido | Média |
| ERR-09 | Delete referência ativa | Deletar role que tem agents | API deve retornar erro, frontend exibe mensagem | Alta |
| ERR-10 | Delete team com agents | Deletar team que tem agents | API deve retornar erro ou cascata (verificar comportamento) | Alta |
| ERR-11 | 502 proxy error | Dashboard → API → Registry com Registry off | Status 502 "Registry unavailable" propagado ao usuário | Alta |
| ERR-12 | Auto-refresh durante erro | Registry cai enquanto dashboard aberto | Dashboard continua tentando refresh cada 5s, mostra dados antigos ou loading | Média |

---

## 14. Data Integrity & Relationships

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| DI-01 | Agent → Role mapping | Criar agent com role X | Agent detail mostra role name, icon, capabilities corretos | Alta |
| DI-02 | Agent → Team mapping | Criar agent no team Y | Agent aparece na seção correta da home. Agent detail mostra team name | Alta |
| DI-03 | Role agent count | Criar agents com mesma role | Roles page mostra contagem correta de agents por role | Alta |
| DI-04 | Team agent count | Criar agents no mesmo team | Teams page mostra contagem correta. Home mostra working/total | Alta |
| DI-05 | Task → Team mapping | Criar task pro team X | Task mostra team name e emoji corretos | Alta |
| DI-06 | Task → Agent mapping | Task locked por agent | Task detail mostra agent name que está processando | Alta |
| DI-07 | Logs → Agent filter | Abrir agent detail | Logs filtrados só mostram logs daquele agent | Alta |
| DI-08 | Home stats corretos | Criar/deletar agents | Stats cards (Total, Working, Idle, Teams) refletem valores corretos | Alta |
| DI-09 | Role delete - verifica dependências | Deletar role com agents associados | Comportamento definido: erro ou cascade | Alta |
| DI-10 | Team delete - verifica dependências | Deletar team com agents/tasks | Comportamento definido: erro ou cascade | Alta |

---

## 15. Concurrent Operations

| ID | Cenário | Passos | Resultado Esperado | Prioridade |
|----|---------|--------|--------------------|------------|
| CON-01 | Deploy múltiplos agents | Abrir 2 deploy modals rápido | Cada deploy funciona independentemente | Média |
| CON-02 | Create + Delete simultâneos | Criar agent enquanto deleta outro | Ambas operações completam, lista reflete estado final correto | Média |
| CON-03 | Editar enquanto auto-refresh | Editar role/team enquanto refetch roda | Formulário não perde dados durante refresh da lista | Alta |
| CON-04 | Múltiplas abas | Criar agent em aba A, verificar em aba B | Aba B mostra novo agent no próximo auto-refresh (5s) | Média |
| CON-05 | Duplo clique em submit | Clicar Deploy 2x rápido | Só 1 request enviada (botão disables durante deploy) | Alta |

---

## 📊 Resumo

| Categoria | Total | Alta | Média | Baixa |
|-----------|-------|------|-------|-------|
| Deploy Agent Modal | 26 | 16 | 8 | 2 |
| Create Role Modal | 20 | 13 | 6 | 1 |
| Edit Role Modal | 7 | 7 | 0 | 0 |
| Create Team Modal | 9 | 6 | 3 | 0 |
| Edit Team Modal | 4 | 4 | 0 | 0 |
| Create Task Modal | 15 | 10 | 4 | 1 |
| Agent CRUD | 15 | 15 | 0 | 0 |
| Agent Detail Page | 16 | 11 | 5 | 0 |
| Task Actions | 10 | 6 | 4 | 0 |
| Settings Forms | 24 | 11 | 13 | 0 |
| Infrastructure | 7 | 4 | 3 | 0 |
| Form Validation | 8 | 4 | 2 | 2 |
| API Error Handling | 12 | 9 | 3 | 0 |
| Data Integrity | 10 | 10 | 0 | 0 |
| Concurrent Ops | 5 | 2 | 3 | 0 |
| **TOTAL** | **188** | **128** | **54** | **6** |

---

*Criado por Clawdia 🦞 — 2026-02-10*
*Complementa TEST_SCENARIOS.md (142 cenários de layout/nav) com 188 cenários de forms/CRUD/API*
*Total combinado: 330 cenários de teste*
