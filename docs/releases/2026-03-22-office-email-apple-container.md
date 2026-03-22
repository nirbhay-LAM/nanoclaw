# Release: Office Docs, File Delivery, Multi-Identity Email

**Date:** 2026-03-22
**Commits:** 15423cc, 17553fa
**Container rebuild:** Yes
**Service restart:** Yes

## What Changed

### New Capabilities

**Office Document Creation**
- RSK can create Word (.docx), PowerPoint (.pptx), and Excel (.xlsx) files
- Libraries: `docx`, `pptxgenjs`, `exceljs` installed globally in container
- Container skill at `container/skills/office-docs/` with code patterns
- `NODE_PATH` set so imports work from any directory

**WhatsApp File Sending**
- New `mcp__nanoclaw__send_file` MCP tool sends documents as WhatsApp attachments
- Channel interface extended with optional `sendFile` method
- IPC protocol extended to handle `type: "file"` messages
- MIME type utility (`src/mime.ts`) for proper content-type headers

**Multi-Identity Email**
- New email MCP server (`container/email-mcp/`) with `googleapis`
- Three identities: personal (hellorsk0618@gmail.com), consulting (rsk@lamconsultinggroup.com), dental (rsk@cafesmilestudio.com via Send As alias)
- Tools: `mcp__email__send_email`, `mcp__email__list_identities`
- Conditionally loaded — only starts when email config exists
- OAuth setup script at `scripts/gmail-oauth.mjs`

### Apple Container Fixes

- Removed `/dev/null` file mount from container-runner (Apple Container only supports directory mounts)
- Added `detectAppleContainerGateway()` — probes bridge100 IP for credential proxy
- Proxy binds to bridge IP instead of localhost (VMs can't reach host loopback)
- Added `fetchLatestWaWebVersion` to WhatsApp group sync (fixes 405 errors)

### Architecture: Container Compilation Fix

- **Problem:** `googleapis` in agent-runner caused OOM (exit 134) during runtime TypeScript compilation
- **Band-aid applied then removed:** 2GB container memory + 1.5GB TSC heap
- **Proper fix:** Separated email-mcp into its own pre-compiled package
  - Email-mcp compiles at Docker build time, not every container startup
  - Agent-runner no longer depends on `googleapis`
  - Runtime TSC is lightweight again
  - Container memory right-sized to 1024MB

## Configuration

- Email identities: `~/.config/nanoclaw/email-identities.json`
- OAuth credentials: `~/.gmail-mcp/personal/` and `~/.gmail-mcp/lam/`
- Two GCP projects created (RSK Personal Email, RSK LAM Email)

## Known Issues

- None observed. All capabilities tested and confirmed working by RSK.

## Test Results

- 21 test files, 316 tests — all passing
- Host build clean (tsc)
- Container build clean
- End-to-end verified: document creation, WhatsApp file send, email send
