---
name: email
description: Send emails from multiple identities with optional attachments. Use when the user asks you to email something, send a message via email, or deliver a document by email.
---

# Email — Multi-Identity Sending

You have three email identities. Use `mcp__email__list_identities` to see them, or reference this guide:

| Identity | Email | Use For |
|----------|-------|---------|
| `personal` | Personal Gmail | Personal correspondence |
| `consulting` | @lamconsultinggroup.com | LAM Consulting Group business |
| `dental` | @cafesmilestudio.com | Cafe Smile Studio (dental practice) |

## Sending an Email

```
mcp__email__send_email(
  identity: "consulting",
  to: "client@example.com",
  subject: "Proposal for Review",
  body: "Hi, please find the proposal attached.",
  attachments: ["proposal.docx"]
)
```

Attachments must exist in `/workspace/group/files/` — create them first using the office-docs skill.

## Choosing the Right Identity

- **If the user specifies** which email to use, follow their instruction
- **If the context is clear** (dental patient → dental, consulting client → consulting), infer it
- **If unsure**, ask the user which identity to send from
- The `dental` identity sends from the @cafesmilestudio.com alias on the LAM Consulting Workspace

## Common Patterns

**Create a document and email it:**
1. Create the document using office-docs skill → `/workspace/group/files/report.docx`
2. Send: `mcp__email__send_email(identity: "consulting", to: "...", subject: "...", body: "...", attachments: ["report.docx"])`

**Email without attachment:**
```
mcp__email__send_email(
  identity: "personal",
  to: "friend@example.com",
  subject: "Quick note",
  body: "Hey, just wanted to check in..."
)
```

## Error Handling

- If credentials aren't configured for an identity, you'll get a clear error — ask the lead developer (Claude) to set them up
- If an attachment file doesn't exist, create it first
- OAuth tokens auto-refresh — if you get an auth error, ask the user to re-run the email identity setup
