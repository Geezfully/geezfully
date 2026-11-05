#!/usr/bin/env bash
# Watches ATTP Pontaj from outside Supabase and restarts the project when its
# Data API stops answering. Run by .github/workflows/attp-pontaj-health.yml.
#
# Why: on 5 Nov 2026 PostgREST's query pool wedged for ~70 minutes while the
# database stayed healthy; only a project restart cleared it, and nobody knew
# until the location called. This finds it within minutes and fixes it.
#
# Healthy = rpc/health_ping answers 200 (PostgREST really ran a query) and the
# auth service answers 200. Four checks 30 s apart; one success is enough, so a
# single slow request never triggers anything.
#
# State (STATE_FILE, carried between runs by the workflow's cache):
#   down_since    when the current outage was first seen (epoch seconds)
#   last_alert    when the last "still down" email went out
#   last_restart  when this script last restarted the project
#
# Env: PROJECT_REF, ANON_KEY, STATE_FILE, MODE (watch | test-alert | check-token),
#      RESTART_TOKEN (optional; without it the script only alerts),
#      ALERT_KEY + ALERT_TO (Resend), RUN_URL.
set -uo pipefail

API="${API_URL:-https://${PROJECT_REF}.supabase.co}"
MGMT="${MGMT_URL:-https://api.supabase.com/v1/projects/${PROJECT_REF}}"
PAUSE="${CHECK_PAUSE:-30}"         # seconds between checks (tests shorten it)
SETTLE="${RESTART_SETTLE:-60}"    # seconds to let a restart begin before re-checking
RESTART_COOLDOWN=2700   # 45 min: never restart twice in a row for the same outage
ALERT_REPEAT=1800       # 30 min between repeated "still down" emails
RECOVERY_WAIT="${RECOVERY_WAIT_S:-600}"   # after a restart, wait up to 10 min for it to come back
POLL="${RECOVERY_POLL:-20}"

now() { date +%s; }
moldova() { TZ=Europe/Chisinau date -d "@$1" '+%d.%m.%Y %H:%M'; }
changed=false

state_get() { jq -r --arg k "$1" '.[$k] // empty' "$STATE_FILE" 2>/dev/null; }
state_set() {
  local tmp; tmp="$(mktemp)"
  [ -s "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"
  if [ -z "$2" ]; then jq --arg k "$1" 'del(.[$k])' "$STATE_FILE" > "$tmp"
  else jq --arg k "$1" --argjson v "$2" '.[$k] = $v' "$STATE_FILE" > "$tmp"; fi
  mv "$tmp" "$STATE_FILE"; changed=true
}

last_detail=""
check_once() {
  local body ping auth
  body="$(mktemp)"
  ping="$(curl -s -m 20 -o "$body" -w '%{http_code}' -X POST "$API/rest/v1/rpc/health_ping" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' -d '{}')"
  auth="$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$API/auth/v1/health" -H "apikey: $ANON_KEY")"
  last_detail="Data API: HTTP $ping $(head -c 160 "$body" | tr -d '\n'); Auth: HTTP $auth"
  rm -f "$body"
  [ "$ping" = 200 ] && [ "$auth" = 200 ]
}
is_healthy() {
  local i
  for i in 1 2 3 4; do
    if check_once; then echo "healthy: $last_detail"; return 0; fi
    echo "check $i failed: $last_detail"
    [ "$i" -lt 4 ] && sleep "$PAUSE"
  done
  return 1
}

send_mail() { # subject, html
  if [ -z "${ALERT_KEY:-}" ] || [ -z "${ALERT_TO:-}" ]; then echo "no alert secrets; would send: $1"; return 0; fi
  jq -n --arg to "$ALERT_TO" --arg s "$1" --arg h "$2" \
    '{from: "ATTP Pontaj watcher <onboarding@resend.dev>", to: [$to], subject: $s, html: $h}' > "$RUNNER_TEMP/health-mail.json"
  curl --fail-with-body --silent --show-error -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $ALERT_KEY" -H 'Content-Type: application/json' \
    --data "@$RUNNER_TEMP/health-mail.json" > /dev/null || echo "email failed: $1"
}

finish() { echo "changed=$changed" >> "$GITHUB_OUTPUT"; exit 0; }
link="<p><a href=\"$RUN_URL\">Watcher run log</a></p>"

case "${MODE:-watch}" in
  test-alert)
    send_mail "ATTP Pontaj watcher: test email" "<p>The ATTP Pontaj watcher can send you alerts. Nothing is wrong.</p>$link"
    finish ;;
  check-token)
    if [ -z "${RESTART_TOKEN:-}" ]; then echo "ATTP_PONTAJ_RESTART_TOKEN is not set: alerts only, no automatic restart."; exit 1; fi
    code="$(curl -s -o /dev/null -w '%{http_code}' "$MGMT" -H "Authorization: Bearer $RESTART_TOKEN")"
    echo "Management API with the restart token: HTTP $code (200 = the token can see the project)"
    [ "$code" = 200 ] || exit 1
    finish ;;
esac

t="$(now)"
down_since="$(state_get down_since)"

if is_healthy; then
  if [ -n "$down_since" ]; then
    mins=$(( (t - down_since) / 60 ))
    send_mail "ATTP Pontaj is back up" "<p>ATTP Pontaj answers normally again. It was first seen down at $(moldova "$down_since") (Moldova time), about $mins minutes ago.</p>$link"
    state_set down_since ""; state_set last_alert ""
  fi
  finish
fi

# ── down ──────────────────────────────────────────────────────────────────
[ -n "$down_since" ] || { down_since="$t"; state_set down_since "$t"; }
last_restart="$(state_get last_restart)"; last_alert="$(state_get last_alert)"
since="$(moldova "$down_since")"

if [ -n "${RESTART_TOKEN:-}" ] && { [ -z "$last_restart" ] || [ $(( t - last_restart )) -ge $RESTART_COOLDOWN ]; }; then
  code="$(curl -s -o "$RUNNER_TEMP/restart.out" -w '%{http_code}' -X POST "$MGMT/restart" -H "Authorization: Bearer $RESTART_TOKEN")"
  state_set last_restart "$t"; state_set last_alert "$t"
  if [ "$code" != 200 ]; then
    send_mail "ATTP Pontaj is DOWN, automatic restart failed" "<p>ATTP Pontaj stopped answering (first seen $since, Moldova time).</p><p>Last check: $last_detail</p><p>The automatic restart was refused: HTTP $code $(head -c 300 "$RUNNER_TEMP/restart.out"). Restart it by hand: Supabase dashboard → ATTP Pontaj → Project Settings → General → Restart project.</p>$link"
    finish
  fi
  send_mail "ATTP Pontaj is down, restarting it automatically" "<p>ATTP Pontaj stopped answering (first seen $since, Moldova time).</p><p>Last check: $last_detail</p><p>The project is being restarted automatically. You will get another email when it is back, or if the restart does not help.</p>$link"
  waited=0; sleep "$SETTLE"
  while [ $waited -lt $RECOVERY_WAIT ]; do
    if check_once; then
      mins=$(( ($(now) - down_since) / 60 ))
      send_mail "ATTP Pontaj is back up after an automatic restart" "<p>The automatic restart worked. ATTP Pontaj answers normally again, about $mins minutes after the problem was first seen ($since, Moldova time).</p><p>The app reconnects by itself; anything typed while it was down was not saved and needs re-entering.</p>$link"
      state_set down_since ""; state_set last_alert ""
      finish
    fi
    sleep "$POLL"; waited=$(( waited + POLL ))
  done
  send_mail "ATTP Pontaj still DOWN after an automatic restart" "<p>ATTP Pontaj was restarted automatically but still does not answer (first seen $since, Moldova time).</p><p>Last check: $last_detail</p><p>The watcher will not restart it again for 45 minutes. Check the Supabase dashboard and status.supabase.com.</p>$link"
  finish
fi

# no token, or a restart already tried for this outage: alert, at most every 30 min
if [ -z "$last_alert" ] || [ $(( t - last_alert )) -ge $ALERT_REPEAT ]; then
  why="Automatic restart is not set up (no ATTP_PONTAJ_RESTART_TOKEN secret)."
  [ -n "${RESTART_TOKEN:-}" ] && why="The project was already restarted automatically at $(moldova "$last_restart"), less than 45 minutes ago, so the watcher will not restart it again yet."
  send_mail "ATTP Pontaj is DOWN" "<p>ATTP Pontaj stopped answering (first seen $since, Moldova time).</p><p>Last check: $last_detail</p><p>$why Restart it by hand: Supabase dashboard → ATTP Pontaj → Project Settings → General → Restart project.</p>$link"
  state_set last_alert "$t"
fi
finish
