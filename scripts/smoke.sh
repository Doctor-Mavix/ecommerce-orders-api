#!/usr/bin/env bash
# End-to-end walk against a running server: sign in, then drive a complaint through its whole
# life. Used to check that the same HTTP contract holds whatever DB_PROVIDER is set to.
#
#   pnpm admin:create --email admin@orangcode.bj --password '…'   # once per database
#   pnpm dev
#   ./scripts/smoke.sh
set -euo pipefail

# 127.0.0.1 rather than localhost: the server binds IPv4, and `localhost` may resolve to ::1.
BASE="${BASE:-http://127.0.0.1:3000/api/v1}"
ORIGIN="${ORIGIN:-http://localhost:5173}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@orangcode.bj}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin-Local-2026!}"
ADMIN_TYPE="${ADMIN_TYPE:-agent}"

TOKEN=''

# Every back-office route is guarded, so the bearer travels with the call rather than being
# repeated at each site. The public citizen routes simply ignore it.
call() {
  local method=$1 path=$2 body=${3:-}
  local args=(-sS -X "$method" "$BASE$path" -H "origin: $ORIGIN")
  [[ -n $TOKEN ]] && args+=(-H "authorization: Bearer $TOKEN")
  [[ -n $body ]] && args+=(-H 'content-type: application/json' -d "$body")
  curl "${args[@]}"
}

# Status code only, with the bearer sent when a third argument asks for it.
status_of() {
  local method=$1 path=$2
  local args=(-sS -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" -H "origin: $ORIGIN")
  [[ -n ${3:-} ]] && args+=(-H "authorization: Bearer $3")
  curl "${args[@]}"
}

json() {
  node -e 'process.stdin.on("data",(d)=>{const b=JSON.parse(d);console.log(process.argv[1].split(".").reduce((a,k)=>a?.[k],b)??"")})' "$1"
}

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step 'sign in as the back-office admin'
LOGIN=$(call POST /auth/login \
  "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"actorType\":\"$ADMIN_TYPE\"}")
TOKEN=$(json data.accessToken <<<"$LOGIN")
if [[ -z $TOKEN ]]; then
  echo "$LOGIN"
  echo "No token. Create the account first: pnpm admin:create --email $ADMIN_EMAIL --password '…'" >&2
  echo 'An account with MFA on cannot be used here: this script cannot answer the challenge.' >&2
  exit 1
fi
echo "signed in as $ADMIN_EMAIL"

step 'submit a complaint (public route, no token needed)'
CREATED=$(call POST /complaints '{
  "reporterName": "Awa Kponou",
  "reporterEmail": "awa@example.bj",
  "category": "voirie",
  "subject": "Lampadaire hors service depuis deux semaines",
  "description": "Le lampadaire au carrefour est eteint, le carrefour est dangereux la nuit."
}')
echo "$CREATED"
ID=$(json data.id <<<"$CREATED")
TRACKING=$(json data.trackingNumber <<<"$CREATED")

step "public tracking of $TRACKING"
call GET "/complaints/track/$TRACKING"

step 'the same detail without a token (expect 401)'
status_of GET "/complaints/$ID"
echo

step 'list'
call GET '/complaints?limit=5'

step 'triage: priority then assignment'
call PATCH "/complaints/$ID/priority" '{"priority":"high"}' >/dev/null
call PATCH "/complaints/$ID/assignee" '{"assignedTo":"agent-42"}' >/dev/null

step 'status walk: in_review -> in_progress -> resolved'
call POST "/complaints/$ID/status" '{"status":"in_review","message":"recevable"}' >/dev/null
call POST "/complaints/$ID/status" '{"status":"in_progress"}' >/dev/null
call POST "/complaints/$ID/status" '{"status":"resolved","message":"lampadaire remplace"}' >/dev/null

step 'illegal transition is refused (expect 409)'
call POST "/complaints/$ID/status" '{"status":"pending"}'

step 'note'
call POST "/complaints/$ID/notes" '{"message":"citoyen informe par SMS"}' >/dev/null

step 'detail with the full timeline, attributed to the signed-in agent'
call GET "/complaints/$ID"

step 'soft delete, then the same id must 404'
status_of DELETE "/complaints/$ID" "$TOKEN"; echo ' <- delete'
status_of GET "/complaints/$ID" "$TOKEN"; echo ' <- get after delete'
status_of GET "/complaints/track/$TRACKING"; echo ' <- track after delete'

printf '\n\033[1mdone\033[0m\n'
