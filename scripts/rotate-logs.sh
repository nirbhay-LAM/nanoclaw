#!/usr/bin/env bash
#
# Rotate NanoClaw's launchd logs.
#
# launchd owns the file descriptors for these files (StandardOutPath /
# StandardErrorPath in com.nanoclaw.plist) and holds them open for the life of
# the service. It opens them O_APPEND but never reopens them, so a rename-based
# rotator (newsyslog, logrotate) breaks silently: launchd keeps writing to the
# renamed inode, the fresh file stays empty, and the disk is never freed.
#
# The live file therefore has to be truncated in place, never moved. Because the
# fd is O_APPEND, writes resume at offset 0 after truncation rather than leaving
# a sparse hole.
#
# Trade-off: log lines written between the copy and the truncate are lost. The
# window is milliseconds and the alternative (stopping the service to rotate)
# is worse for a always-on assistant.
#
# Scheduled hourly by ~/Library/LaunchAgents/com.nanoclaw.logrotate.plist. On a
# fresh install that agent has to be recreated (setup/service.ts only generates
# com.nanoclaw.plist):
#
#   launchctl load ~/Library/LaunchAgents/com.nanoclaw.logrotate.plist
#
# Tunable via NANOCLAW_LOG_DIR / NANOCLAW_LOG_MAX_BYTES / NANOCLAW_LOG_KEEP.
# Safe to run by hand at any time; it no-ops below the size threshold.

set -euo pipefail

LOG_DIR="${NANOCLAW_LOG_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/logs}"
MAX_BYTES="${NANOCLAW_LOG_MAX_BYTES:-$((20 * 1024 * 1024))}"
KEEP="${NANOCLAW_LOG_KEEP:-5}"

rotate() {
  local log="$1"
  [ -f "$log" ] || return 0

  local size
  size=$(stat -f%z "$log")
  if [ "$size" -lt "$MAX_BYTES" ]; then
    return 0
  fi

  # Age out the oldest archive, then shift the rest up: .4.gz -> .5.gz, etc.
  rm -f "$log.$KEEP.gz"
  local i
  for ((i = KEEP - 1; i >= 1; i--)); do
    if [ -f "$log.$i.gz" ]; then
      mv "$log.$i.gz" "$log.$((i + 1)).gz"
    fi
  done

  # Copy first, truncate second. Never `mv` the live file — see header.
  cp "$log" "$log.1"
  : >"$log"
  gzip -f "$log.1"

  echo "$(date '+%Y-%m-%dT%H:%M:%S') rotated $(basename "$log") at ${size} bytes"
}

for name in nanoclaw.log nanoclaw.error.log; do
  rotate "$LOG_DIR/$name"
done
