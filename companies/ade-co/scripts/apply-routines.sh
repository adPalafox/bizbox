#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  apply-routines.sh --company-id <id> [--paperclip-url <url>] [--timezone <iana>]

Creates/updates Ade Co routines that are stored in the Paperclip DB (not in company packages).

Requires:
  - curl
  - jq
  - Paperclip server reachable (default http://localhost:3100)
  - Auth: either a board session cookie in your environment (if applicable) OR set BIZBOX_API_KEY

Example:
  ./companies/ade-co/scripts/apply-routines.sh \
    --company-id b84ceca7-735b-48cc-bf63-78110d21f6b9 \
    --paperclip-url http://localhost:3100
EOF
}

company_id=""
paperclip_url="http://localhost:3100"
timezone_override=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --company-id)
      company_id="$2"
      shift 2
      ;;
    --paperclip-url)
      paperclip_url="$2"
      shift 2
      ;;
    --timezone)
      timezone_override="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$company_id" ]]; then
  echo "Missing --company-id" >&2
  usage >&2
  exit 2
fi

declare -a auth_headers=()
if [[ -n "${BIZBOX_API_KEY:-}" ]]; then
  auth_headers+=( -H "Authorization: Bearer ${BIZBOX_API_KEY}" )
fi

routine_manifest_path="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/routines/daily-number-line-iteration.json"

if [[ ! -f "$routine_manifest_path" ]]; then
  echo "Missing routine manifest: $routine_manifest_path" >&2
  exit 1
fi

manifest="$(cat "$routine_manifest_path")"
title="$(jq -r '.title' <<<"$manifest")"

timezone="$(jq -r '.timezone' <<<"$manifest")"
if [[ -n "$timezone_override" ]]; then
  timezone="$timezone_override"
fi

cron_expression="$(jq -r '.cronExpression' <<<"$manifest")"
trigger_label="$(jq -r '.triggerLabel' <<<"$manifest")"

routine_title="$(jq -r '.title' <<<"$manifest")"
routine_description="$(jq -r '.description' <<<"$manifest")"
priority="$(jq -r '.priority' <<<"$manifest")"
status="$(jq -r '.status' <<<"$manifest")"
concurrency_policy="$(jq -r '.concurrencyPolicy' <<<"$manifest")"
catchup_policy="$(jq -r '.catchUpPolicy' <<<"$manifest")"

echo "Resolving number-line projectId."
project_id="$(
  curl -sS "${paperclip_url}/api/companies/${company_id}/projects" ${auth_headers[@]+"${auth_headers[@]}"} |
    jq -r '.[] | select((.urlKey // "") == "number-line" or .name == "Number Line" or .name == "Number Line app") | .id' |
    head -n 1
)"

if [[ -z "$project_id" || "$project_id" == "null" ]]; then
  echo "Could not resolve number-line projectId for company ${company_id}." >&2
  echo "Make sure you imported ./companies/ade-co into this company first." >&2
  exit 1
fi

echo "Resolving tech-lead agentId (fallback ceo)."
agent_list_json="$(curl -sS "${paperclip_url}/api/companies/${company_id}/agents" ${auth_headers[@]+"${auth_headers[@]}"} )"
assignee_agent_id="$(jq -r '.[] | select(.urlKey == "tech-lead") | .id' <<<"$agent_list_json" | head -n 1)"
if [[ -z "$assignee_agent_id" || "$assignee_agent_id" == "null" ]]; then
  assignee_agent_id="$(jq -r '.[] | select(.urlKey == "ceo") | .id' <<<"$agent_list_json" | head -n 1)"
fi
if [[ -z "$assignee_agent_id" || "$assignee_agent_id" == "null" ]]; then
  echo "Could not resolve assignee agentId (tech-lead/ceo) for company ${company_id}." >&2
  exit 1
fi

echo "Checking for existing routine by title."
## Note: bash 3.2 + `set -u` can treat empty arrays as unset in expansions.
routines_json="$(curl -sS "${paperclip_url}/api/companies/${company_id}/routines" ${auth_headers[@]+"${auth_headers[@]}"} )"
existing_routine_id="$(jq -r --arg title "$routine_title" '.routines[] | select(.title == $title) | .id' <<<"$routines_json" | head -n 1)"

create_payload="$(
  jq -n \
    --arg projectId "$project_id" \
    --arg assigneeAgentId "$assignee_agent_id" \
    --arg title "$routine_title" \
    --arg description "$routine_description" \
    --arg priority "$priority" \
    --arg status "$status" \
    --arg concurrencyPolicy "$concurrency_policy" \
    --arg catchUpPolicy "$catchup_policy" \
    '{
      projectId: $projectId,
      assigneeAgentId: $assigneeAgentId,
      title: $title,
      description: $description,
      priority: $priority,
      status: $status,
      concurrencyPolicy: $concurrencyPolicy,
      catchUpPolicy: $catchUpPolicy
    }'
)"

routine_id=""
if [[ -n "$existing_routine_id" && "$existing_routine_id" != "null" ]]; then
  echo "Updating existing routine ${existing_routine_id}."
  routine_id="$existing_routine_id"
  curl -sS -X PATCH "${paperclip_url}/api/routines/${routine_id}" \
    -H 'content-type: application/json' \
    ${auth_headers[@]+"${auth_headers[@]}"} \
    -d "$create_payload" >/dev/null
else
  echo "Creating routine."
  routine_id="$(
    curl -sS -X POST "${paperclip_url}/api/companies/${company_id}/routines" \
      -H 'content-type: application/json' \
      ${auth_headers[@]+"${auth_headers[@]}"} \
      -d "$create_payload" | jq -r '.routine.id'
  )"
fi

if [[ -z "$routine_id" || "$routine_id" == "null" ]]; then
  echo "Failed to create/update routine." >&2
  exit 1
fi

echo "Ensuring schedule trigger exists (cron=${cron_expression} tz=${timezone})."
routine_json="$(curl -sS "${paperclip_url}/api/routines/${routine_id}" ${auth_headers[@]+"${auth_headers[@]}"} )"
existing_trigger_id="$(
  jq -r --arg kind "schedule" --arg label "$trigger_label" '
    .routine.triggers[]? |
    select(.kind == $kind and (.label // "") == $label) |
    .id
  ' <<<"$routine_json" | head -n 1
)"

trigger_payload="$(
  jq -n \
    --arg kind "schedule" \
    --arg label "$trigger_label" \
    --arg cronExpression "$cron_expression" \
    --arg timezone "$timezone" \
    '{ kind: $kind, label: $label, enabled: true, cronExpression: $cronExpression, timezone: $timezone }'
)"

if [[ -n "$existing_trigger_id" && "$existing_trigger_id" != "null" ]]; then
  curl -sS -X PATCH "${paperclip_url}/api/routine-triggers/${existing_trigger_id}" \
    -H 'content-type: application/json' \
    ${auth_headers[@]+"${auth_headers[@]}"} \
    -d "$trigger_payload" >/dev/null
  trigger_id="$existing_trigger_id"
else
  trigger_id="$(
    curl -sS -X POST "${paperclip_url}/api/routines/${routine_id}/triggers" \
      -H 'content-type: application/json' \
      ${auth_headers[@]+"${auth_headers[@]}"} \
      -d "$trigger_payload" | jq -r '.trigger.id'
  )"
fi

if [[ -z "${trigger_id:-}" || "$trigger_id" == "null" ]]; then
  echo "Failed to create/update trigger." >&2
  exit 1
fi

echo "Done."
echo "routineId=${routine_id}"
echo "triggerId=${trigger_id}"
