/**
 * Email MCP Server for NanoClaw
 * Provides multi-identity Gmail sending, search, and Google Drive versioning.
 * Reads identity config and OAuth credentials from read-only mounts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

// --- Constants ---

export const CONFIG_DIR = '/workspace/email/config';
export const CREDS_BASE = '/workspace/email/creds';
export const FILES_DIR = '/workspace/group/files';

// --- Types ---

export interface EmailAccount {
  credentialsDir: string;
}

export interface EmailIdentity {
  account: string;
  email: string;
  name: string;
  sendAs?: string;
  context?: string;
}

export interface EmailConfig {
  accounts: Record<string, EmailAccount>;
  identities: Record<string, EmailIdentity>;
  defaultIdentity: string;
}

export interface McpResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// --- Config loading ---

export function loadConfig(): EmailConfig | null {
  const configPath = path.join(CONFIG_DIR, 'email-identities.json');
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

export function loadOAuthCredentials(
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

// --- Google API clients ---

export function createAuthClient(accountName: string) {
  const creds = loadOAuthCredentials(accountName);
  if (!creds) {
    throw new Error(
      `No OAuth credentials found for account "${accountName}". Run the email identity setup.`,
    );
  }

  const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  auth.setCredentials({ refresh_token: creds.refreshToken });
  return auth;
}

export function createGmailClient(accountName: string) {
  return google.gmail({ version: 'v1', auth: createAuthClient(accountName) });
}

export function createDriveClient(accountName: string) {
  return google.drive({ version: 'v3', auth: createAuthClient(accountName) });
}

// --- Shared MIME map ---

export const MIME_MAP: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

export function mimeForExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

// --- Drive versioning helpers ---

export type DriveClient = ReturnType<typeof createDriveClient>;

export async function ensureDriveFolder(
  drive: DriveClient,
  name: string,
  parentId?: string,
): Promise<string> {
  const q = [
    `name='${name}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    'trashed=false',
  ];
  if (parentId) q.push(`'${parentId}' in parents`);

  const res = await drive.files.list({
    q: q.join(' and '),
    fields: 'files(id)',
    pageSize: 1,
  });

  const existing = res.data.files?.[0];
  if (existing?.id) return existing.id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
  });

  return created.data.id!;
}

export async function getVersionsFolder(
  drive: DriveClient,
  filename: string,
): Promise<string> {
  const rootId = await ensureDriveFolder(drive, 'NanoClaw');
  return ensureDriveFolder(drive, filename, rootId);
}

// --- Email helpers ---

/** RFC 2047 encoded-word for non-ASCII header values. */
export function encodeRfc2047(text: string): string {
  // Only encode if there are non-ASCII characters
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  const encoded = Buffer.from(text, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

export function buildRawEmail(opts: {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{ filename: string; mimetype: string; content: Buffer }>;
}): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [];

  lines.push(`From: "${encodeRfc2047(opts.fromName)}" <${opts.from}>`);
  lines.push(`To: ${opts.to}`);
  lines.push(`Subject: ${encodeRfc2047(opts.subject)}`);
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

// --- Gmail message helpers ---

interface MessagePayload {
  body?: { data?: string | null; size?: number | null; attachmentId?: string | null } | null;
  mimeType?: string | null;
  filename?: string | null;
  parts?: MessagePayload[] | null;
}

export function extractBody(payload: MessagePayload | null | undefined): string {
  if (!payload) return '';
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  if (payload.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
    }
    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return Buffer.from(htmlPart.body.data, 'base64url').toString('utf-8');
    }
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

export function findAttachments(parts: MessagePayload[] | null | undefined): string[] {
  const attachments: string[] = [];
  if (!parts) return attachments;
  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push(
        `  - ${part.filename} (${part.mimeType}, ${part.body.size || 0} bytes, attachmentId: ${part.body.attachmentId})`,
      );
    }
    if (part.parts) attachments.push(...findAttachments(part.parts));
  }
  return attachments;
}

// --- Shared validation helpers ---

function validateIdentity(
  config: EmailConfig | null,
  identityName: string,
): { identity: EmailIdentity; error?: undefined } | { identity?: undefined; error: McpResult } {
  if (!config) {
    return {
      error: {
        content: [{ type: 'text' as const, text: 'No email identities configured.' }],
        isError: true,
      },
    };
  }

  const identity = config.identities[identityName];
  if (!identity) {
    const available = Object.keys(config.identities).join(', ');
    return {
      error: {
        content: [{ type: 'text' as const, text: `Unknown identity "${identityName}". Available: ${available}` }],
        isError: true,
      },
    };
  }

  return { identity };
}

// --- Tool handlers ---

export async function handleListIdentities(): Promise<McpResult> {
  const config = loadConfig();
  if (!config) {
    return {
      content: [{ type: 'text' as const, text: 'No email identities configured. Ask the lead developer (Claude) to set up email identities.' }],
      isError: true,
    };
  }

  const lines = Object.entries(config.identities).map(([name, identity]) => {
    const context = identity.context ? ` (${identity.context})` : '';
    const isDefault = name === config.defaultIdentity ? ' [default]' : '';
    const alias = identity.sendAs ? ` (sends as: ${identity.sendAs})` : '';
    return `• ${name}: ${identity.name} <${identity.email}>${context}${alias}${isDefault}`;
  });

  return {
    content: [{ type: 'text' as const, text: `Configured email identities:\n${lines.join('\n')}` }],
  };
}

export async function handleSendEmail(args: {
  identity: string;
  to: string;
  subject: string;
  body: string;
  attachments?: string[];
}): Promise<McpResult> {
  const result = validateIdentity(loadConfig(), args.identity);
  if (result.error) return result.error;
  const identity = result.identity;

  // Load attachments
  const attachments: Array<{ filename: string; mimetype: string; content: Buffer }> = [];
  if (args.attachments) {
    for (const filename of args.attachments) {
      const filePath = path.join(FILES_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return {
          content: [{ type: 'text' as const, text: `Attachment not found: ${filePath}. Create the file first.` }],
          isError: true,
        };
      }
      attachments.push({
        filename,
        mimetype: mimeForExtension(filename),
        content: fs.readFileSync(filePath),
      });
    }
  }

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
      content: [{ type: 'text' as const, text: `Email sent from ${identity.name} <${fromEmail}> to ${args.to}.` }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      content: [{ type: 'text' as const, text: `Failed to send email: ${message}` }],
      isError: true,
    };
  }
}

export async function handleSearchMessages(args: {
  identity: string;
  query: string;
  maxResults: number;
}): Promise<McpResult> {
  const result = validateIdentity(loadConfig(), args.identity);
  if (result.error) return result.error;
  const identity = result.identity;

  try {
    const gmail = createGmailClient(identity.account);
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: args.query,
      maxResults: args.maxResults,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No messages found.' }] };
    }

    const summaries: string[] = [];
    for (const msg of messages) {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });

      const headers = detail.data.payload?.headers || [];
      const get = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      summaries.push(
        `ID: ${msg.id}\n  From: ${get('From')}\n  Subject: ${get('Subject')}\n  Date: ${get('Date')}\n  Snippet: ${detail.data.snippet || ''}`,
      );
    }

    return { content: [{ type: 'text' as const, text: summaries.join('\n\n') }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      content: [{ type: 'text' as const, text: `Failed to search messages: ${message}` }],
      isError: true,
    };
  }
}

export async function handleGetMessage(args: {
  identity: string;
  messageId: string;
}): Promise<McpResult> {
  const result = validateIdentity(loadConfig(), args.identity);
  if (result.error) return result.error;
  const identity = result.identity;

  try {
    const gmail = createGmailClient(identity.account);
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: args.messageId,
      format: 'full',
    });

    const headers = res.data.payload?.headers || [];
    const get = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const body = extractBody(res.data.payload as MessagePayload);
    const attachments = findAttachments((res.data.payload as MessagePayload)?.parts);

    const lines = [
      `From: ${get('From')}`,
      `To: ${get('To')}`,
      `Subject: ${get('Subject')}`,
      `Date: ${get('Date')}`,
      '',
      body,
    ];
    if (attachments.length > 0) {
      lines.push('', `Attachments (${attachments.length}):`, ...attachments);
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      content: [{ type: 'text' as const, text: `Failed to get message: ${message}` }],
      isError: true,
    };
  }
}

export async function handleListDriveFiles(args: {
  identity: string;
  query?: string;
  maxResults: number;
}): Promise<McpResult> {
  const result = validateIdentity(loadConfig(), args.identity);
  if (result.error) return result.error;
  const identity = result.identity;

  try {
    const drive = createDriveClient(identity.account);
    const res = await drive.files.list({
      q: args.query || undefined,
      pageSize: args.maxResults,
      fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,owners)',
    });

    const files = res.data.files || [];
    if (files.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No files found.' }] };
    }

    const lines = files.map((f) => {
      const size = f.size ? ` (${Math.round(parseInt(f.size) / 1024)}KB)` : '';
      const owner = f.owners?.[0]?.emailAddress ? ` — shared by ${f.owners[0].emailAddress}` : '';
      return `• ${f.name}${size}${owner}\n  ID: ${f.id}\n  Type: ${f.mimeType}\n  Modified: ${f.modifiedTime}\n  Link: ${f.webViewLink || 'N/A'}`;
    });

    return { content: [{ type: 'text' as const, text: lines.join('\n\n') }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      content: [{ type: 'text' as const, text: `Failed to list Drive files: ${message}` }],
      isError: true,
    };
  }
}

export async function handleGetDriveFile(args: {
  identity: string;
  fileId: string;
  download: boolean;
}): Promise<McpResult> {
  const result = validateIdentity(loadConfig(), args.identity);
  if (result.error) return result.error;
  const identity = result.identity;

  try {
    const drive = createDriveClient(identity.account);
    const meta = await drive.files.get({
      fileId: args.fileId,
      fields: 'id,name,mimeType,size,modifiedTime,webViewLink,owners',
    });

    const file = meta.data;
    const lines = [
      `Name: ${file.name}`,
      `Type: ${file.mimeType}`,
      `Size: ${file.size ? `${Math.round(parseInt(file.size) / 1024)}KB` : 'N/A'}`,
      `Modified: ${file.modifiedTime}`,
      `Link: ${file.webViewLink || 'N/A'}`,
    ];

    if (args.download) {
      fs.mkdirSync(FILES_DIR, { recursive: true });

      const isGoogleDoc = file.mimeType?.startsWith('application/vnd.google-apps.');

      if (isGoogleDoc) {
        const exportMime = 'application/pdf';
        const exportName = `${file.name}.pdf`;
        const res = await drive.files.export(
          { fileId: args.fileId, mimeType: exportMime },
          { responseType: 'arraybuffer' },
        );
        const filePath = path.join(FILES_DIR, exportName);
        fs.writeFileSync(filePath, Buffer.from(res.data as ArrayBuffer));
        lines.push(``, `Downloaded (exported as PDF): ${filePath}`);
      } else {
        const res = await drive.files.get(
          { fileId: args.fileId, alt: 'media' },
          { responseType: 'arraybuffer' },
        );
        const filePath = path.join(FILES_DIR, file.name || args.fileId);
        fs.writeFileSync(filePath, Buffer.from(res.data as ArrayBuffer));
        lines.push(``, `Downloaded: ${filePath}`);
      }
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      content: [{ type: 'text' as const, text: `Failed to get Drive file: ${message}` }],
      isError: true,
    };
  }
}

export async function handleVersionDocument(args: {
  identity: string;
  filename: string;
  note?: string;
}): Promise<McpResult> {
  const result = validateIdentity(loadConfig(), args.identity);
  if (result.error) return result.error;
  const identity = result.identity;

  const filePath = path.join(FILES_DIR, args.filename);
  if (!fs.existsSync(filePath)) {
    return {
      content: [{ type: 'text' as const, text: `File not found: ${filePath}. Create the file first.` }],
      isError: true,
    };
  }

  try {
    const drive = createDriveClient(identity.account);
    const folderId = await getVersionsFolder(drive, args.filename);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const versionName = `${args.filename}_v${timestamp}`;
    const description = args.note || `Version saved on ${new Date().toISOString()}`;

    const res = await drive.files.create({
      requestBody: {
        name: versionName,
        parents: [folderId],
        description,
        mimeType: mimeForExtension(args.filename),
      },
      media: {
        mimeType: mimeForExtension(args.filename),
        body: fs.createReadStream(filePath),
      },
      fields: 'id,name,webViewLink,size',
    });

    const file = res.data;
    const size = file.size ? `${Math.round(parseInt(file.size) / 1024)}KB` : 'unknown size';

    return {
      content: [{
        type: 'text' as const,
        text: `Version saved to Drive:\n  Name: ${file.name}\n  Size: ${size}\n  Note: ${description}\n  ID: ${file.id}\n  Link: ${file.webViewLink || 'N/A'}`,
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      content: [{ type: 'text' as const, text: `Failed to version document: ${message}` }],
      isError: true,
    };
  }
}

export async function handleListVersions(args: {
  identity: string;
  filename: string;
}): Promise<McpResult> {
  const result = validateIdentity(loadConfig(), args.identity);
  if (result.error) return result.error;
  const identity = result.identity;

  try {
    const drive = createDriveClient(identity.account);
    const folderId = await getVersionsFolder(drive, args.filename);

    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,description,createdTime,size)',
      orderBy: 'createdTime desc',
      pageSize: 50,
    });

    const files = res.data.files || [];
    if (files.length === 0) {
      return {
        content: [{ type: 'text' as const, text: `No versions found for "${args.filename}".` }],
      };
    }

    const lines = files.map((f, i) => {
      const size = f.size ? `${Math.round(parseInt(f.size) / 1024)}KB` : '?';
      const note = f.description || 'no note';
      return `${i + 1}. ${f.name} (${size})\n   Date: ${f.createdTime}\n   Note: ${note}\n   ID: ${f.id}`;
    });

    return {
      content: [{
        type: 'text' as const,
        text: `Versions of "${args.filename}" (${files.length} total):\n\n${lines.join('\n\n')}`,
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      content: [{ type: 'text' as const, text: `Failed to list versions: ${message}` }],
      isError: true,
    };
  }
}

export async function handleRestoreDocument(args: {
  identity: string;
  filename: string;
  versionId: string;
}): Promise<McpResult> {
  const result = validateIdentity(loadConfig(), args.identity);
  if (result.error) return result.error;
  const identity = result.identity;

  try {
    const drive = createDriveClient(identity.account);

    const meta = await drive.files.get({
      fileId: args.versionId,
      fields: 'id,name,description,createdTime,size',
    });

    const res = await drive.files.get(
      { fileId: args.versionId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );

    fs.mkdirSync(FILES_DIR, { recursive: true });
    const filePath = path.join(FILES_DIR, args.filename);
    fs.writeFileSync(filePath, Buffer.from(res.data as ArrayBuffer));

    const file = meta.data;
    const size = file.size ? `${Math.round(parseInt(file.size) / 1024)}KB` : 'unknown size';

    return {
      content: [{
        type: 'text' as const,
        text: `Restored "${file.name}" to ${filePath}\n  Original date: ${file.createdTime}\n  Size: ${size}\n  Note: ${file.description || 'none'}`,
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      content: [{ type: 'text' as const, text: `Failed to restore document: ${message}` }],
      isError: true,
    };
  }
}

// --- MCP Server wiring ---

const server = new McpServer({
  name: 'email',
  version: '1.0.0',
});

server.tool(
  'list_identities',
  'List all configured email identities and their associated email addresses. Use this to see which identities are available before sending an email.',
  {},
  handleListIdentities,
);

server.tool(
  'send_email',
  'Send an email from a specific identity. Can include file attachments from /workspace/group/files/. Use list_identities first if unsure which identity to use.',
  {
    identity: z.string().describe('Which email identity to send from (e.g., "personal", "consulting", "dental"). Use list_identities to see available options.'),
    to: z.string().describe('Recipient email address'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body text'),
    attachments: z.array(z.string()).optional().describe('File names to attach, relative to /workspace/group/files/ (e.g., ["report.docx", "data.xlsx"])'),
  },
  handleSendEmail,
);

server.tool(
  'search_messages',
  'Search Gmail messages using Gmail search syntax (e.g., "from:nirbhay subject:report", "has:attachment newer_than:7d"). Returns message summaries.',
  {
    identity: z.string().describe('Email identity to search (e.g., "personal", "consulting")'),
    query: z.string().describe('Gmail search query (same syntax as Gmail search bar)'),
    maxResults: z.number().optional().default(10).describe('Maximum number of messages to return (default 10)'),
  },
  handleSearchMessages,
);

server.tool(
  'get_message',
  'Get the full content of a specific Gmail message by ID. Use search_messages first to find message IDs.',
  {
    identity: z.string().describe('Email identity to use (e.g., "personal", "consulting")'),
    messageId: z.string().describe('Gmail message ID (from search_messages)'),
  },
  handleGetMessage,
);

server.tool(
  'list_drive_files',
  'List files in Google Drive. Supports search queries (e.g., "name contains \'report\'", "mimeType=\'application/pdf\'", "sharedWithMe"). Returns file metadata with links.',
  {
    identity: z.string().describe('Email identity to use (e.g., "consulting" for rsk@lamconsultinggroup.com)'),
    query: z.string().optional().describe('Google Drive search query (optional). Examples: "sharedWithMe", "name contains \'budget\'"'),
    maxResults: z.number().optional().default(20).describe('Maximum number of files to return (default 20)'),
  },
  handleListDriveFiles,
);

server.tool(
  'get_drive_file',
  'Get metadata for a Google Drive file and optionally download it to /workspace/group/files/. For Google Docs/Sheets/Slides, exports as PDF. For binary files, downloads directly.',
  {
    identity: z.string().describe('Email identity to use'),
    fileId: z.string().describe('Google Drive file ID (from list_drive_files)'),
    download: z.boolean().optional().default(false).describe('Whether to download the file to /workspace/group/files/ (default false)'),
  },
  handleGetDriveFile,
);

server.tool(
  'version_document',
  'Save the current version of a local file to Google Drive before modifying it. Creates a timestamped snapshot in NanoClaw/{filename}/ on Drive. Use this before making changes to important documents.',
  {
    identity: z.string().optional().default('consulting').describe('Email identity for Drive auth (defaults to consulting/business account)'),
    filename: z.string().describe('File name in /workspace/group/files/ to version (e.g., "report.docx")'),
    note: z.string().optional().describe('Changelog note describing this version (e.g., "before adding executive summary")'),
  },
  handleVersionDocument,
);

server.tool(
  'list_versions',
  'List all saved versions of a document on Google Drive. Shows version history with timestamps, notes, and file IDs that can be used with restore_document.',
  {
    identity: z.string().optional().default('consulting').describe('Email identity for Drive auth (defaults to consulting/business account)'),
    filename: z.string().describe('Document name to list versions for (e.g., "report.docx")'),
  },
  handleListVersions,
);

server.tool(
  'restore_document',
  'Restore a previous version of a document from Google Drive to the local workspace. Use list_versions first to find the version ID.',
  {
    identity: z.string().optional().default('consulting').describe('Email identity for Drive auth (defaults to consulting/business account)'),
    filename: z.string().describe('Target local filename to restore to (e.g., "report.docx")'),
    versionId: z.string().describe('Drive file ID of the version to restore (from list_versions)'),
  },
  handleRestoreDocument,
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
