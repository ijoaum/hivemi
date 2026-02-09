#!/bin/bash
# HiveMI Issue Runner — Orquestra implementação de issues com auto-compact
# Roda como cron job isolado, controla o ciclo de vida de implementação

set -euo pipefail

WORKSPACE="/home/openclaw/.openclaw/workspace"
HIVEMI="$WORKSPACE/hivemi"
TRACKER="$HIVEMI/.context/issue-tracker.json"
GATEWAY="http://127.0.0.1:18789"
GW_TOKEN="2274d39604fa8a10902955f1d0158cf82707fc4ff6ef1728ae4d5b782e2eb6d2"

# Issue queue (ordered by implementation priority)
ISSUE_QUEUE=(69 44 71 45 46 48 47 55 49 50 70 72)

get_current_issue() {
  if [ -f "$TRACKER" ]; then
    python3 -c "import json; d=json.load(open('$TRACKER')); print(d.get('currentIssue', ''))"
  fi
}

get_status() {
  if [ -f "$TRACKER" ]; then
    python3 -c "import json; d=json.load(open('$TRACKER')); print(d.get('status', 'idle'))"
  else
    echo "idle"
  fi
}

set_tracker() {
  local issue="$1"
  local status="$2"
  python3 -c "
import json, datetime
d = {}
if __import__('os').path.exists('$TRACKER'):
    d = json.load(open('$TRACKER'))
d['currentIssue'] = $issue
d['status'] = '$status'
d['updatedAt'] = datetime.datetime.utcnow().isoformat() + 'Z'
if 'completedIssues' not in d:
    d['completedIssues'] = []
json.dump(d, open('$TRACKER', 'w'), indent=2)
"
}

mark_complete() {
  local issue="$1"
  python3 -c "
import json, datetime
d = json.load(open('$TRACKER'))
if $issue not in d.get('completedIssues', []):
    d.setdefault('completedIssues', []).append($issue)
d['status'] = 'idle'
d['currentIssue'] = None
d['updatedAt'] = datetime.datetime.utcnow().isoformat() + 'Z'
json.dump(d, open('$TRACKER', 'w'), indent=2)
"
}

get_next_issue() {
  local completed
  completed=$(python3 -c "
import json, os
d = {}
if os.path.exists('$TRACKER'):
    d = json.load(open('$TRACKER'))
print(','.join(str(x) for x in d.get('completedIssues', [])))
" 2>/dev/null)

  for issue in "${ISSUE_QUEUE[@]}"; do
    if [[ ! ",$completed," == *",$issue,"* ]]; then
      echo "$issue"
      return
    fi
  done
  echo ""
}

send_agent_message() {
  local message="$1"
  local session="${2:-main}"
  curl -s -X POST "$GATEWAY/hooks/agent" \
    -H "Authorization: Bearer $GW_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"message\": $(python3 -c "import json; print(json.dumps('$message'))"), \"sessionKey\": \"$session\"}"
}

compact_session() {
  # Send /compact as a user message to trigger compaction
  send_agent_message "/compact Finalizei issue. Manter: journal, issue tracker, decisões técnicas."
}

case "${1:-status}" in
  start)
    # Start working on next issue
    ISSUE=$(get_next_issue)
    if [ -z "$ISSUE" ]; then
      echo "All issues completed!"
      exit 0
    fi
    set_tracker "$ISSUE" "in_progress"
    echo "Starting issue #$ISSUE"
    send_agent_message "Leia o arquivo $HIVEMI/.context/issue-tracker.json e o journal. Implemente a issue #$ISSUE do HiveMI. Siga a estratégia: uma issue por vez, commits atômicos, checklist no GitHub. Quando terminar, escreva ISSUE_DONE no final da mensagem."
    ;;

  complete)
    # Mark current issue as done and compact
    ISSUE=$(get_current_issue)
    if [ -z "$ISSUE" ]; then
      echo "No issue in progress"
      exit 1
    fi
    mark_complete "$ISSUE"
    echo "Issue #$ISSUE marked complete. Compacting..."
    compact_session
    ;;

  next)
    # Complete current + compact + start next (called by agent when done)
    ISSUE=$(get_current_issue)
    if [ -n "$ISSUE" ]; then
      mark_complete "$ISSUE"
      echo "Issue #$ISSUE complete."
    fi
    # Wait for compact to settle, then start next
    compact_session
    sleep 10
    NEXT=$(get_next_issue)
    if [ -n "$NEXT" ]; then
      set_tracker "$NEXT" "in_progress"
      send_agent_message "Issue anterior finalizada e compactada. Agora implemente a issue #$NEXT. Leia o tracker e o journal pra contexto."
    else
      echo "All issues done!"
    fi
    ;;

  status)
    echo "=== HiveMI Issue Tracker ==="
    if [ -f "$TRACKER" ]; then
      cat "$TRACKER" | python3 -m json.tool
    else
      echo "No tracker yet. Run: $0 start"
    fi
    NEXT=$(get_next_issue)
    echo "Next issue: ${NEXT:-ALL DONE}"
    ;;

  *)
    echo "Usage: $0 {start|complete|next|status}"
    ;;
esac
