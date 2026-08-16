#!/usr/bin/env bash
#
# Alert if NanoClaw is not running.
#
# The in-process alert in whatsapp.ts covers a WhatsApp logout, but it can only
# fire if the process is alive enough to reach that code. Anything that stops
# the process outright — a crash, a failed start, launchd giving up on a respawn
# loop — is silent. That is what happened in August: WhatsApp logged out, the
# process exited, launchd stopped retrying, and the outage was only noticed
# hours later by asking.
#
# This runs on a timer, independently of the service, so it still speaks when
# the service cannot.
#
# Scheduled by ~/Library/LaunchAgents/com.nanoclaw.watchdog.plist.
# Safe to run by hand; it only alerts when something is actually wrong.

set -euo pipefail

PROJECT_DIR="${NANOCLAW_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
STATE_FILE="$PROJECT_DIR/data/watchdog-state"
# Matches the in-process alert cooldown so the two cannot double up.
COOLDOWN_SECONDS="${NANOCLAW_WATCHDOG_COOLDOWN:-1800}"

is_running() {
  pgrep -f "$PROJECT_DIR/dist/index.js" >/dev/null 2>&1
}

alert() {
  local message="$1"
  local now last
  now=$(date +%s)

  if [ -f "$STATE_FILE" ]; then
    last=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
    if [ $((now - last)) -lt "$COOLDOWN_SECONDS" ]; then
      return 0
    fi
  fi

  mkdir -p "$(dirname "$STATE_FILE")"
  echo "$now" >"$STATE_FILE"

  osascript -e "display notification \"$message\" with title \"NanoClaw is down\" sound name \"Basso\"" \
    >/dev/null 2>&1 || true
  echo "$(date '+%Y-%m-%dT%H:%M:%S') ALERT $message"
}

if is_running; then
  # Recovered: drop the marker so the next outage alerts immediately.
  rm -f "$STATE_FILE"
  exit 0
fi

# Distinguish "launchd gave up" from "briefly restarting", because the fix
# differs: the first needs a manual kickstart, the second needs nothing.
if launchctl list 2>/dev/null | grep -q 'com\.nanoclaw$'; then
  alert "Service is loaded but not running. Check logs, then: launchctl kickstart -k gui/\$(id -u)/com.nanoclaw"
else
  alert "Service is not loaded. Run: launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/com.nanoclaw.plist"
fi
