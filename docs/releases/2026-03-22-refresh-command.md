# Release: /refresh Command + Email Encoding Fix

**Date:** 2026-03-22
**Commit:** 8a46c19
**Container rebuild:** Yes
**Service restart:** Yes

## What Changed

### /refresh Command

RSK can now save his memory and start a fresh session on demand.

**How to use:** Tell RSK "/refresh" or "save everything and start fresh"

**What happens:**
1. RSK reviews the conversation for anything important not yet saved
2. RSK writes context to CLAUDE.md and auto-memory
3. RSK confirms what was saved
4. RSK triggers session reset via IPC
5. Next message starts a clean session with all memory intact

**What persists:** CLAUDE.md, auto-memory, skills, files, settings
**What resets:** Conversation transcript, screenshots, tool call history, shell state

**Files added/changed:**
- `container/skills/refresh/SKILL.md` (new container skill)
- `container/agent-runner/src/ipc-mcp-stdio.ts` (new `refresh_session` MCP tool)
- `src/ipc.ts` (new `refresh_session` IPC handler)
- `src/db.ts` (new `deleteSession` function)
- `src/index.ts` (wired `refreshSession` into IPC deps)

### Email Subject Encoding Fix

Non-ASCII characters in email subject lines (em dashes, curly quotes, accented characters) are now properly encoded using RFC 2047 Base64 encoding. Previously they rendered as garbled text.

**File changed:** `container/email-mcp/src/email-mcp.ts`

## Known Issues

None.

## Test Results

- 21 test files, 316 tests, all passing
- Host build clean
- Container build clean
