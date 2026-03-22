/**
 * Email MCP Server for NanoClaw
 * Provides multi-identity Gmail sending with attachment support.
 * Reads identity config and OAuth credentials from read-only mounts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

const CONFIG_DIR = '/workspace/email/config';
const CREDS_BASE = '/workspace/email/creds';
const FILES_DIR = '/workspace/group/files';

// --- Types ---

interface EmailAccount {
  credentialsDir: string;
}

interface EmailIdentity {
  account: string;
  email: string;
  name: string;
  sendAs?: string;
  context?: string;
}

interface EmailConfig {
  accounts: Record<string, EmailAccount>;
  identities: Record<string, EmailIdentity>;
  defaultIdentity: string;
}

// --- Config loading ---

function loadConfig(): EmailConfig | null {
  const configPath = path.join(CONFIG_DIR, 'email-identities.json');
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function loadOAuthCredentials(
  accountName: string,
): { clientId: string; clientSecret: string; refreshToken: string } | null {
  const credDir = path.join(CREDS_BASE, accountName);

  // Load OAuth keys (client ID and secret)
  const keysPath = path.join(credDir, 'gcp-oauth.keys.json');
  if (!fs.existsSync(keysPath)) return null;
  const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
  const installed = keys.installed || keys.web;
  if (!installed) return null;

  // Load saved credentials (refresh token)
  const credsPath = path.join(credDir, 'credentials.json');
  if (!fs.existsSync(credsPath)) return null;
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));

  return {
    clientId: installed.client_id,
    clientSecret: installed.client_secret,
    refreshToken: creds.refresh_token,
  };
}

// --- Gmail API ---

function createGmailClient(accountName: string) {
  const creds = loadOAuthCredentials(accountName);
  if (!creds) {
    throw new Error(
      `No OAuth credentials found for account "${accountName}". Run the email identity setup.`,
    );
  }

  const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  auth.setCredentials({ refresh_token: creds.refreshToken });

  return google.gmail({ version: 'v1', auth });
}

function buildRawEmail(opts: {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{ filename: string; mimetype: string; content: Buffer }>;
}): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [];

  lines.push(`From: "${opts.fromName}" <${opts.from}>`);
  lines.push(`To: ${opts.to}`);
  lines.push(`Subject: ${opts.subject}`);
  lines.push('MIME-Version: 1.0');

  if (opts.attachments && opts.attachments.length > 0) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('');
    lines.push(opts.body);

    for (const att of opts.attachments) {
      lines.push(`--${boundary}`);
      lines.push(
        `Content-Type: ${att.mimetype}; name="${att.filename}"`,
      );
      lines.push('Content-Transfer-Encoding: base64');
      lines.push(
        `Content-Disposition: attachment; filename="${att.filename}"`,
      );
      lines.push('');
      lines.push(att.content.toString('base64'));
    }
    lines.push(`--${boundary}--`);
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('');
    lines.push(opts.body);
  }

  const raw = lines.join('\r\n');
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// --- MCP Server ---

const server = new McpServer({
  name: 'email',
  version: '1.0.0',
});

server.tool(
  'list_identities',
  'List all configured email identities and their associated email addresses. Use this to see which identities are available before sending an email.',
  {},
  async () => {
    const config = loadConfig();
    if (!config) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No email identities configured. Ask the lead developer (Claude) to set up email identities.',
          },
        ],
        isError: true,
      };
    }

    const lines = Object.entries(config.identities).map(
      ([name, identity]) => {
        const context = identity.context ? ` (${identity.context})` : '';
        const isDefault = name === config.defaultIdentity ? ' [default]' : '';
        const alias = identity.sendAs ? ` (sends as: ${identity.sendAs})` : '';
        return `• ${name}: ${identity.name} <${identity.email}>${context}${alias}${isDefault}`;
      },
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: `Configured email identities:\n${lines.join('\n')}`,
        },
      ],
    };
  },
);

server.tool(
  'send_email',
  'Send an email from a specific identity. Can include file attachments from /workspace/group/files/. Use list_identities first if unsure which identity to use.',
  {
    identity: z
      .string()
      .describe(
        'Which email identity to send from (e.g., "personal", "consulting", "dental"). Use list_identities to see available options.',
      ),
    to: z.string().describe('Recipient email address'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body text'),
    attachments: z
      .array(z.string())
      .optional()
      .describe(
        'File names to attach, relative to /workspace/group/files/ (e.g., ["report.docx", "data.xlsx"])',
      ),
  },
  async (args) => {
    const config = loadConfig();
    if (!config) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No email identities configured.',
          },
        ],
        isError: true,
      };
    }

    const identity = config.identities[args.identity];
    if (!identity) {
      const available = Object.keys(config.identities).join(', ');
      return {
        content: [
          {
            type: 'text' as const,
            text: `Unknown identity "${args.identity}". Available: ${available}`,
          },
        ],
        isError: true,
      };
    }

    // Load attachments
    const attachments: Array<{
      filename: string;
      mimetype: string;
      content: Buffer;
    }> = [];
    if (args.attachments) {
      for (const filename of args.attachments) {
        const filePath = path.join(FILES_DIR, filename);
        if (!fs.existsSync(filePath)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Attachment not found: ${filePath}. Create the file first.`,
              },
            ],
            isError: true,
          };
        }
        const ext = path.extname(filename).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.docx':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.pptx':
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          '.xlsx':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.pdf': 'application/pdf',
          '.csv': 'text/csv',
          '.txt': 'text/plain',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
        };
        attachments.push({
          filename,
          mimetype: mimeMap[ext] || 'application/octet-stream',
          content: fs.readFileSync(filePath),
        });
      }
    }

    // Build and send email
    try {
      const gmail = createGmailClient(identity.account);
      const fromEmail = identity.sendAs || identity.email;
      const raw = buildRawEmail({
        from: fromEmail,
        fromName: identity.name,
        to: args.to,
        subject: args.subject,
        body: args.body,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Email sent from ${identity.name} <${fromEmail}> to ${args.to}.`,
          },
        ],
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to send email: ${message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Email MCP server error: ${err}\n`);
  process.exit(1);
});
