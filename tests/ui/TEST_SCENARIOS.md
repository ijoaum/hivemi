# HiveMI Dashboard — UI Test Scenarios

> Cenários de teste de interface para o dashboard HiveMI.  
> Criado por Clawdia 🦞 em 2026-02-10.

---

## 📋 Índice

- [1. Navigation & Layout](#1-navigation--layout)
- [2. Agents (Home Page)](#2-agents-home-page)
- [3. Agent Detail Page](#3-agent-detail-page)
- [4. Deploy Agent Modal](#4-deploy-agent-modal)
- [5. Tasks Page](#5-tasks-page)
- [6. Create Task Modal](#6-create-task-modal)
- [7. Teams Page](#7-teams-page)
- [8. Roles Page](#8-roles-page)
- [9. Settings Page](#9-settings-page)
- [10. Logs Page](#10-logs-page)
- [11. Theme & Responsiveness](#11-theme--responsiveness)
- [12. Error Handling & Edge Cases](#12-error-handling--edge-cases)

---

## 1. Navigation & Layout

| ID | Cenário | Passos | Resultado Esperado | Status |
|----|---------|--------|--------------------|--------|
| NAV-01 | Sidebar renderiza corretamente | Abrir dashboard | Logo "hivemi", 6 nav items (Agents, Tasks, Teams, Roles, Settings, Logs), versão "0.1.0" | |
| NAV-02 | Navegação entre páginas | Clicar em cada item do menu | URL muda, conteúdo correto carrega, item ativo fica destacado (amber) | |
| NAV-03 | Loading spinner na navegação | Clicar em um nav item | Ícone do item muda pra Loader2 spinning enquanto carrega | |
| NAV-04 | Mobile hamburger menu | Reduzir viewport < 768px | Header fixo com hambúrguer aparece, sidebar some | |
| NAV-05 | Mobile sidebar abre/fecha | Clicar hambúrguer → clicar overlay | Sidebar abre com animação slide-in, overlay escuro, clica fora fecha | |
| NAV-06 | Mobile sidebar fecha ao navegar | Abrir sidebar mobile → clicar nav item | Sidebar fecha automaticamente após navegação | |
| NAV-07 | Theme toggle | Clicar "Light Mode" / "Dark Mode" | Tema alterna, ícone muda (Sun ↔ Moon), classes dark: aplicadas | |
| NAV-08 | Footer info | Verificar footer da sidebar | Mostra "Cluster: local-dev" e "Version: 0.1.0" | |

## 2. Agents (Home Page)

| ID | Cenário | Passos | Resultado Esperado | Status |
|----|---------|--------|--------------------|--------|
| AGT-01 | Loading skeleton | Abrir home page | Skeleton cards animados aparecem antes dos dados | |
| AGT-02 | Agents agrupados por team | Esperar dados carregar | Agents aparecem dentro das seções de team com cores corretas | |
| AGT-03 | Status indicators | Verificar agent cards | Dots coloridos corretos: green=working, amber=idle, red=error, gray=offline | |
| AGT-04 | StatusBar desktop | Verificar header em desktop | StatusBar com contadores (working/idle/error) visível | |
| AGT-05 | Stats mobile | Verificar header em mobile | Dots coloridos com números em vez do StatusBar completo | |
| AGT-06 | Quick Stats grid | Verificar cards no final | 4 cards: Total Agents, Working, Idle, Teams com números corretos | |
| AGT-07 | Team vazia | Team sem agents | Mostra "No agents in this team yet" centralizado | |
| AGT-08 | Agent card - menu | Clicar gear icon no agent card | Dropdown com Start/Stop, Restart, Destroy | |
| AGT-09 | Agent card - stop | Agent online → gear → Stop | ConfirmDialog aparece, confirmar muda status pra offline | |
| AGT-10 | Agent card - start | Agent offline → gear → Start | Agent muda pra idle | |
| AGT-11 | Agent card - restart | Agent online → gear → Restart | ConfirmDialog, confirmar → offline → idle | |
| AGT-12 | Agent card - destroy | Gear → Destroy | ConfirmDialog destrutivo (vermelho), confirmar deleta agent | |
| AGT-13 | Agent card - link | Clicar nome do agent | Navega pra /agents/[id] | |
| AGT-14 | Deploy button desktop | Clicar "Deploy Agent" | Modal de deploy abre | |
| AGT-15 | Deploy button mobile | Verificar botão em mobile | Só mostra ícone hexagon, sem texto | |
| AGT-16 | Auto-refresh | Esperar 5 segundos | Dados atualizam automaticamente sem flickering | |
| AGT-17 | Agent card - task running | Agent com status "working" | Card mostra task atual com background colorido, dot pulsa | |
| AGT-18 | Agent card - outside click | Abrir menu → clicar fora | Menu fecha | |

## 3. Agent Detail Page

| ID | Cenário | Passos | Resultado Esperado | Status |
|----|---------|--------|--------------------|--------|
| DET-01 | Page load | Navegar pra /agents/[id] | Header com nome, role icon, status dot, role e team name | |
| DET-02 | Back button | Clicar seta ← | Volta pra home (/) | |
| DET-03 | Stats cards | Verificar grid | 4 cards: Total Tasks, Completed, Failed, Active | |
| DET-04 | Recent tasks list | Verificar seção | Últimas 5 tasks com título, data e status badge | |
| DET-05 | Recent logs | Verificar seção | Últimos 10 logs com timestamp, level e mensagem | |
| DET-06 | Configuration sidebar | Verificar painel direito | ID, Model, Endpoint, Last Heartbeat, Created | |
| DET-07 | Role info sidebar | Verificar painel | Ícone, nome, descrição, capabilities tags | |
| DET-08 | Stop agent | Clicar "Stop" | ConfirmDialog, confirmar muda status | |
| DET-09 | Start agent | Agent offline → "Start" | Botão verde, agent vai pra idle | |
| DET-10 | More actions menu | Clicar ⋮ | Dropdown com Restart e Destroy | |
| DET-11 | Destroy agent | ⋮ → Destroy | ConfirmDialog destrutivo, confirmar redireciona pra / | |
| DET-12 | Force destroy | Destroy agent que tá working | ConfirmDialog de force destroy aparece | |
| DET-13 | Agent not found | Navegar pra /agents/id-inexistente | Mostra "Agent not found" com botão pra voltar | |
| DET-14 | Destroyed agent | Agent destroyed | Botões de ação não aparecem | |
| DET-15 | Auto-refresh | Esperar 5s | Dados atualizam automaticamente | |

## 4. Deploy Agent Modal

| ID | Cenário | Passos | Resultado Esperado | Status |
|----|---------|--------|--------------------|--------|
| DEP-01 | Modal abre | Clicar "Deploy Agent" | Modal com backdrop blur, form completo | |
| DEP-02 | Nome random | Verificar campo nome | Nome gerado automaticamente da lista (Atlas, Nova, etc) | |
| DEP-03 | Gerar novo nome | Clicar dado 🎲 | Novo nome aleatório aparece | |
| DEP-04 | Role dropdown | Clicar no dropdown de role | Lista com ícones e descrições, seleção destaca em amber | |
| DEP-05 | Role dropdown - outside click | Abrir dropdown → clicar fora | Dropdown fecha | |
| DEP-06 | Team select | Verificar select de team | Lista todos os teams disponíveis | |
| DEP-07 | Model selection | Clicar em diferentes modelos | Grid 2x2, selecionado fica com borda amber | |
| DEP-08 | Auto-start toggle | Clicar toggle | Alterna entre amber (on) e cinza (off) | |
| DEP-09 | Deploy - sucesso | Preencher tudo → Deploy | Loading spinner → overlay de sucesso com ✓ → auto-close | |
| DEP-10 | Deploy - erro | Simular erro na API | Banner vermelho com mensagem de erro | |
| DEP-11 | Validação | Deixar nome vazio | Botão Deploy fica desabilitado (cinza) | |
| DEP-12 | Fechar modal | Clicar X ou backdrop | Modal fecha, form reseta | |
| DEP-13 | Não fechar durante deploy | Clicar backdrop durante deploying | Modal não fecha | |
| DEP-14 | Form disabled durante deploy | Iniciar deploy | Todos os campos ficam disabled/opacity-50 | |

## 5. Tasks Page

| ID | Cenário | Passos | Resultado Esperado | Status |
|----|---------|--------|--------------------|--------|
| TSK-01 | Stats cards | Abrir /tasks | 4 cards: Queued, Running, Completed, Failed com contadores | |
| TSK-02 | Task cards render | Verificar grid | Cards com título, agent, team, priority emoji, status badge | |
| TSK-03 | Status filter | Selecionar status específico | Só mostra tasks daquele status | |
| TSK-04 | Team filter | Selecionar team | Só mostra tasks daquele team | |
| TSK-05 | Filtros combinados | Status + Team | Ambos filtros aplicam juntos | |
| TSK-06 | Nenhum resultado | Filtrar com combinação sem resultado | "No tasks match the current filters" | |
| TSK-07 | Task card - running | Task com status "locked" | Mostra progress bar com tempo | |
| TSK-08 | Task card - failed | Task com status "failed" | Borda vermelha, mostra mensagem de erro | |
| TSK-09 | Priority icons | Verificar tasks | 🔴 high, 🟡 medium, ⚪ low | |
| TSK-10 | Relative time | Verificar timestamps | "just now", "5m ago", "2h ago" etc | |
| TSK-11 | API unavailable | API fora | "(API unavailable)" em amarelo no header | |
| TSK-12 | Auto-refresh | Esperar 5s | Tasks atualizam automaticamente | |

## 6. Create Task Modal

| ID | Cenário | Passos | Resultado Esperado | Status |
|----|---------|--------|--------------------|--------|
| CTK-01 | Modal abre | Trigger de criar task | Form com Title, Description, Team, Priority, Input | |
| CTK-02 | Priority selector | Clicar em Low/Medium/High | Botão selecionado muda cor (gray/amber/red) | |
| CTK-03 | Validação required | Tentar submit sem title ou team | Botão disabled, form não submete | |
| CTK-04 | Criar com sucesso | Preencher e submeter | Modal fecha, form reseta, callback chamado | |
| CTK-05 | Erro na criação | API retorna erro | Banner vermelho com mensagem | |
| CTK-06 | Input data | Preencher campo input | Textarea monospace aceita dados | |
| CTK-07 | Fechar modal | X ou backdrop | Modal fecha | |

## 7. Teams Page

| ID | Cenário | Passos | Resultado Esperado | Status |
|----|---------|--------|--------------------|--------|
| TMS-01 | Stats | Abrir /teams | 3 cards: Total Teams, Active, Agents | |
| TMS-02 | Team cards | Verificar grid | Cards com nome, ícone, cor, contagem de agents | |
| TMS-03 | Criar team | "+ New Team" → preencher form | Modal com Name, Icon picker, Color picker | |
| TMS-04 | Icon picker | Clicar ícones | Selecionado fica com borda amber | |
| TMS-05 | Color picker | Clicar cores | Selecionada fica com borda branca e scale | |
| TMS-06 | Editar team | Clicar edit no card | Modal abre preenchido com dados atuais | |
| TMS-07 | Deletar team | Clicar delete | ConfirmDialog destrutivo, confirmar deleta | |
| TMS-08 | Empty state | Nenhum team | "No teams yet" com sugestão de criar | |
| TMS-09 | API unavailable | API fora | "(API unavailable)" em amarelo | |

## 8. Roles Page

| ID | Cenário | Passos | Resultado Esperado | Status |
|----|---------|--------|--------------------|--------|
| ROL-01 | Stats | Abrir /roles | 3 cards: Total Roles, Active, Agents | |
| ROL-02 | Role cards | Verificar grid | Cards com nome, ícone, descrição, capabilities, agent count | |
| ROL-03 | Criar role | "+ New Role" | Modal com Name, Slug, Description, Icon, Color, Capabilities, System Prompt | |
| ROL-04 | Auto-slug | Digitar nome | Slug gerado automaticamente (slugify) | |
| ROL-05 | Slug manual | Editar slug manualmente | Auto-slug desativa | |
| ROL-06 | Capabilities | Digitar "code, test, review" | Aceita comma-separated, converte pra array | |
| ROL-07 | System prompt | Digitar prompt | Textarea monospace, required | |
| ROL-08 | Validação | Deixar campos obrigatórios vazios | Botão disabled | |
| ROL-09 | Editar role | Edit no card | Modal preenchido com dados atuais | |
| ROL-10 | Deletar role | Delete no card | ConfirmDialog destrutivo | |
| ROL-11 | Empty state | Nenhum role | "No roles yet" | |

## 9. Settings Page

| ID | Cenário | Passos | Resultado Esperado | Status |
|----|---------|--------|--------------------|--------|
| SET-01 | Section navigation | Clicar em cada seção | Conteúdo muda, seção ativa destacada | |
| SET-02 | Mobile horizontal scroll | Viewport < 768px | Seções em scroll horizontal | |
| SET-03 | General - Cluster name | Editar campo | Input aceita texto | |
| SET-04 | General - Toggles | Clicar toggles | Auto-start e Debug mode alternam | |
| SET-05 | Infra - Reconciliation | Verificar seção | Status badge, stats grid, issues list | |
| SET-06 | Infra - Reconcile button | Clicar "Reconcile" | Refetch dos dados de reconciliação | |
| SET-07 | Infra - Destroy orphan | Clicar "Destroy" em orphaned VM | Confirm nativo, executa destroy | |
| SET-08 | Infra - Costs | Verificar seção | Monthly/Projected/Accumulated, breakdown per instance | |
| SET-09 | Agents settings | Verificar inputs | Max Concurrent, Heartbeat Interval, Task Timeout | |
| SET-10 | LLM Providers | Verificar lista | OpenAI/Anthropic connected, Google not configured | |
| SET-11 | LLM Default select | Mudar provider | Select alterna entre OpenAI e Anthropic | |
| SET-12 | Secrets list | Verificar lista | 4 secrets com nome, source, last updated | |
| SET-13 | 1Password status | Verificar card | "Connected", Vault: Clawdia | |
| SET-14 | Notifications | Verificar toggles | 4 toggles (task complete, failed, agent offline, daily digest) | |
| SET-15 | Danger Zone | Verificar botões | "Reset Cluster" e "Delete Everything" em vermelho | |

## 10. Logs Page

| ID | Cenário | Passos | Resultado Esperado | Status |
|----|---------|--------|--------------------|--------|
| LOG-01 | Stats cards | Abrir /logs | 5 cards: Errors, Warnings, Info, Debug, Lifecycle com contadores | |
| LOG-02 | Level filter | Clicar em stat card | Toggle filtra por level, card fica destacado | |
| LOG-03 | Search | Digitar no campo search | Filtra mensagens por texto | |
| LOG-04 | Source filter | Selecionar source | Filtra por source | |
| LOG-05 | Agent filter | Selecionar agent | Filtra por agentId | |
| LOG-06 | Show debug | Toggle checkbox | Mostra/esconde logs debug | |
| LOG-07 | Log entry colors | Verificar entries | Cores corretas: red=error, yellow=warn, blue=info, gray=debug, green=lifecycle | |
| LOG-08 | Log entry layout | Verificar entry | Timestamp, level badge, source (desktop), agent name, message, metadata indicator | |
| LOG-09 | Export button | Verificar presença | Botão "Export" existe | |
| LOG-10 | Live button | Verificar presença | Botão "Live" com ícone Radio | |
| LOG-11 | Footer counts | Verificar footer | "Showing X of Y" e "Auto-refresh: 5s" | |
| LOG-12 | Mock data fallback | API fora | "(using mock data)" em amarelo, mostra dados mock | |
| LOG-13 | Empty state | Filtros sem resultado | "No logs match the current filters" | |
| LOG-14 | Error log highlight | Log com level error | Background bg-red-500/5 | |

## 11. Theme & Responsiveness

| ID | Cenário | Passos | Resultado Esperado | Status |
|----|---------|--------|--------------------|--------|
| THM-01 | Dark mode default | Abrir app | Tema dark por padrão (class="dark" no html) | |
| THM-02 | Toggle to light | Clicar theme toggle | Todas as páginas mudam pra light mode | |
| THM-03 | Toggle back to dark | Clicar de novo | Volta pra dark mode | |
| RES-01 | Mobile 375px | Viewport 375px | Layout funcional, sem overflow horizontal | |
| RES-02 | Tablet 768px | Viewport 768px | Grid se ajusta, sidebar estática aparece | |
| RES-03 | Desktop 1440px | Viewport 1440px | Grid completo, 4-5 colunas de cards | |
| RES-04 | Agent cards responsive | Diferentes viewports | 1 col mobile → 2 tablet → 3-5 desktop | |
| RES-05 | Task cards responsive | Diferentes viewports | 1 col mobile → 2 tablet → 3 desktop | |
| RES-06 | Text truncation | Textos longos | Nomes e tasks truncam com "..." | |

## 12. Error Handling & Edge Cases

| ID | Cenário | Passos | Resultado Esperado | Status |
|----|---------|--------|--------------------|--------|
| ERR-01 | API totalmente fora | Desligar backend | Logs usa mock data, outras páginas mostram "(API unavailable)" | |
| ERR-02 | Sem agents | Nenhum agent na API | Teams vazias com "No agents in this team yet" | |
| ERR-03 | Sem teams | Nenhum team na API | Home vazia, sem seções de team | |
| ERR-04 | Sem tasks | Nenhuma task | "No tasks match the current filters" | |
| ERR-05 | Deploy com API error | Deploy → API retorna 500 | Modal mostra erro, permite tentar de novo | |
| ERR-06 | Concurrent deploys | Deploy rápido 2x | Não duplica agent (loading state previne) | |
| ERR-07 | Stale data | Mudar dado no backend | Auto-refresh pega mudança em ≤5s | |
| ERR-08 | ConfirmDialog cancel | Abrir qualquer confirmação → Cancel | Dialog fecha, nenhuma ação executada | |
| ERR-09 | ConfirmDialog backdrop | Abrir confirmação → clicar fora | Dialog fecha | |
| ERR-10 | Deep link direto | Abrir /agents/[id] direto | Página carrega corretamente | |

---

## 📊 Resumo

| Seção | Total de Cenários |
|-------|------------------|
| Navigation & Layout | 8 |
| Agents (Home) | 18 |
| Agent Detail | 15 |
| Deploy Agent Modal | 14 |
| Tasks Page | 12 |
| Create Task Modal | 7 |
| Teams Page | 9 |
| Roles Page | 11 |
| Settings Page | 15 |
| Logs Page | 14 |
| Theme & Responsiveness | 9 |
| Error Handling | 10 |
| **TOTAL** | **142** |
