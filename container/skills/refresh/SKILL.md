---
name: refresh
description: Save important context to memory and start a fresh session. Use when the user says "/refresh", "start fresh", "clear your context", or when conversations get heavy with screenshots and large outputs.
---

# /refresh - Save Memory and Start Fresh

When triggered, follow these steps exactly:

## Step 1: Review and Save

Review your current conversation and identify anything important that isn't already saved in your memory or CLAUDE.md. Look for:

- **Decisions made** during this session
- **User preferences** expressed (how they like things done, what to avoid)
- **Contact information** shared (names, emails, phone numbers)
- **Project context** (what's being worked on, status, blockers)
- **Business context** (client names, project details, deadlines)
- **Anything you'd need to know** if starting this conversation from scratch

Write important context to `/workspace/group/CLAUDE.md` using the Read and Edit tools. Keep it structured and organized under the existing sections.

## Step 2: Confirm What Was Saved

Tell the user what you saved. Be specific. For example:

> Saved to memory before refresh:
> - Added contact: John Smith (john@example.com)
> - Updated project status: website redesign moved to review
> - Noted preference: prefers bullet-point summaries

If nothing new needs saving, say so: "Everything important is already in memory. Nothing new to save."

## Step 3: Trigger the Refresh

Call the MCP tool:

```
mcp__nanoclaw__refresh_session()
```

Then tell the user:

> Session refresh requested. My memory is intact. Send me a message when you're ready and I'll pick up where we left off.

## What persists across refresh

- CLAUDE.md (your structured memory)
- Auto-memory (Claude Code's built-in memory system)
- Skills and capabilities
- Files in /workspace/group/files/

## What resets

- Conversation context (screenshots, large outputs, tool call history)
- Session transcript
- Shell state
