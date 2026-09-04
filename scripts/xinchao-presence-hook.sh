#!/bin/sh

# Claude Code UserPromptSubmit hook for Xinchao conversation presence.
# Reports "the user arrived" without sending prompt text, then injects the
# compact projection returned by the presence apply.

set -u

jq_bin=$(command -v jq 2>/dev/null || true)
curl_bin=$(command -v curl 2>/dev/null || true)
if [ -z "$jq_bin" ] || [ -z "$curl_bin" ]; then
  exit 0
fi

hook_input=$(cat || true)
if [ -z "$hook_input" ]; then
  exit 0
fi

session_id=$(printf '%s' "$hook_input" | "$jq_bin" -r '
  if (.session_id | type) == "string" and (.session_id | length) > 0
  then .session_id[0:120]
  else "claude-code"
  end
' 2>/dev/null) || exit 0

transcript_path=$(printf '%s' "$hook_input" | "$jq_bin" -r '
  if (.transcript_path | type) == "string" and (.transcript_path | length) > 0
  then .transcript_path
  else empty
  end
' 2>/dev/null) || true

explicit_id=$(printf '%s' "$hook_input" | "$jq_bin" -r '
  first(
    (.uuid, .turn_id, .prompt_id, .event_id)
    | select((type == "string") and (length > 0) and (length <= 120))
  ) // empty
' 2>/dev/null) || true

token=${XINCHAO_SERVICE_TOKEN:-}
if [ -z "$token" ] && [ -n "${XINCHAO_SERVICE_TOKEN_FILE:-}" ]; then
  token=$(tr -d '\r\n' < "$XINCHAO_SERVICE_TOKEN_FILE" 2>/dev/null || true)
fi
if [ -z "$token" ]; then
  exit 0
fi

presence_url=${XINCHAO_PRESENCE_URL:-${XINCHAO_CONVERSATION_EVENT_URL:-}}
if [ -z "$presence_url" ]; then
  heartbeat_url=${XINCHAO_HEARTBEAT_URL:-https://xinchao.guchuan.men/v1/heartbeat}
  presence_url=$(printf '%s' "$heartbeat_url" | sed 's#/v1/heartbeat/*$#/v1/conversation-event#')
fi
case "$presence_url" in
  https://*|http://127.0.0.1:*|http://localhost:*) ;;
  *) exit 0 ;;
esac

if [ -n "$explicit_id" ]; then
  event_id=$explicit_id
else
  transcript_meta="none"
  if [ -n "${transcript_path:-}" ] && [ -e "$transcript_path" ]; then
    transcript_meta=$(wc -c < "$transcript_path" 2>/dev/null | tr -d ' ')
    transcript_meta="${transcript_meta}:$(date -r "$transcript_path" +%s 2>/dev/null || printf '0')"
  fi
  event_id=$(printf 'presence:%s:%s:%s' "$session_id" "${transcript_path:-}" "$transcript_meta" \
    | cksum | awk '{print "presence-" $1}')
fi

payload=$("$jq_bin" -cn \
  --arg session_id "$session_id" \
  --arg event_id "$event_id" \
  '{session_id: $session_id, event_id: $event_id}')

response=$("$curl_bin" -fsS --max-time 8 \
  -X POST \
  -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' \
  --data "$payload" \
  "$presence_url" 2>/dev/null) || exit 0

projection=$(printf '%s' "$response" | "$jq_bin" -c '
  select((.revision | type) == "number")
  | {
      revision,
      consciousness,
      fatigue,
      top_drives,
      duplicate
    }
' 2>/dev/null) || exit 0

if [ -z "$projection" ] || [ "$projection" = "null" ]; then
  exit 0
fi

"$jq_bin" -cn --arg projection "$projection" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $projection
  }
}'
exit 0
