import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock fs before imports
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      createReadStream: vi.fn(),
    },
  };
});

// Mock googleapis
const mockGmailSend = vi.fn();
const mockGmailList = vi.fn();
const mockGmailGet = vi.fn();
const mockDriveFilesList = vi.fn();
const mockDriveFilesGet = vi.fn();
const mockDriveFilesCreate = vi.fn();
const mockDriveFilesExport = vi.fn();

vi.mock('googleapis', () => {
  function OAuth2() {
    return { setCredentials: vi.fn() };
  }
  return {
    google: {
      auth: { OAuth2 },
      gmail: vi.fn(() => ({
        users: {
          messages: {
            send: mockGmailSend,
            list: mockGmailList,
            get: mockGmailGet,
          },
        },
      })),
      drive: vi.fn(() => ({
        files: {
          list: mockDriveFilesList,
          get: mockDriveFilesGet,
          create: mockDriveFilesCreate,
          export: mockDriveFilesExport,
        },
      })),
    },
  };
});

import {
  encodeRfc2047,
  mimeForExtension,
  buildRawEmail,
  extractBody,
  findAttachments,
  loadConfig,
  loadOAuthCredentials,
  ensureDriveFolder,
  getVersionsFolder,
  handleListIdentities,
  handleSendEmail,
  handleSearchMessages,
  handleGetMessage,
  handleListDriveFiles,
  handleGetDriveFile,
  handleVersionDocument,
  handleListVersions,
  handleRestoreDocument,
  CONFIG_DIR,
  CREDS_BASE,
  type EmailConfig,
} from './email-mcp.js';

// --- Test fixtures ---

function mockConfig(): EmailConfig {
  return {
    accounts: { personal: { credentialsDir: 'personal' } },
    identities: {
      personal: { account: 'personal', email: 'test@gmail.com', name: 'Test User' },
      consulting: {
        account: 'personal',
        email: 'test@biz.com',
        name: 'Biz User',
        sendAs: 'alias@biz.com',
        context: 'consulting',
      },
    },
    defaultIdentity: 'personal',
  };
}

function mockOAuthFiles() {
  vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
    const s = String(p);
    return s.includes('gcp-oauth.keys.json') ||
      s.includes('credentials.json') ||
      s.includes('email-identities.json');
  });
  vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike) => {
    const s = String(p);
    if (s.includes('email-identities.json')) {
      return JSON.stringify(mockConfig()) as unknown as Buffer;
    }
    if (s.includes('gcp-oauth.keys.json')) {
      return JSON.stringify({
        installed: { client_id: 'cid', client_secret: 'csecret' },
      }) as unknown as Buffer;
    }
    if (s.includes('credentials.json')) {
      return JSON.stringify({ refresh_token: 'rtoken' }) as unknown as Buffer;
    }
    return '' as unknown as Buffer;
  });
}

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
});

describe('encodeRfc2047', () => {
  it('returns ASCII text unchanged', () => {
    expect(encodeRfc2047('Hello World')).toBe('Hello World');
  });

  it('encodes non-ASCII text', () => {
    const result = encodeRfc2047('Café');
    expect(result).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    const decoded = Buffer.from(result.slice(10, -2), 'base64').toString('utf-8');
    expect(decoded).toBe('Café');
  });

  it('returns empty string unchanged', () => {
    expect(encodeRfc2047('')).toBe('');
  });
});

describe('mimeForExtension', () => {
  it('returns correct MIME for known extensions', () => {
    expect(mimeForExtension('report.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(mimeForExtension('photo.png')).toBe('image/png');
    expect(mimeForExtension('data.pdf')).toBe('application/pdf');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(mimeForExtension('file.xyz')).toBe('application/octet-stream');
  });

  it('handles files with no extension', () => {
    expect(mimeForExtension('README')).toBe('application/octet-stream');
  });
});

describe('buildRawEmail', () => {
  it('produces base64url-encoded output', () => {
    const raw = buildRawEmail({
      from: 'a@b.com',
      fromName: 'Alice',
      to: 'b@c.com',
      subject: 'Test',
      body: 'Hello',
    });
    expect(raw).not.toMatch(/[+/=]/);
  });

  it('includes correct headers in plain text email', () => {
    const raw = buildRawEmail({
      from: 'sender@test.com',
      fromName: 'Sender',
      to: 'recipient@test.com',
      subject: 'Subject Line',
      body: 'Body text',
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('From: "Sender" <sender@test.com>');
    expect(decoded).toContain('To: recipient@test.com');
    expect(decoded).toContain('Subject: Subject Line');
    expect(decoded).toContain('MIME-Version: 1.0');
    expect(decoded).toContain('Body text');
  });

  it('uses multipart/mixed for attachments', () => {
    const raw = buildRawEmail({
      from: 'a@b.com',
      fromName: 'A',
      to: 'b@c.com',
      subject: 'With attachment',
      body: 'See attached',
      attachments: [
        { filename: 'doc.pdf', mimetype: 'application/pdf', content: Buffer.from('pdf-data') },
      ],
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('multipart/mixed');
    expect(decoded).toContain('Content-Disposition: attachment; filename="doc.pdf"');
    expect(decoded).toContain(Buffer.from('pdf-data').toString('base64'));
  });

  it('uses multipart/alternative for HTML email', () => {
    const raw = buildRawEmail({
      from: 'a@b.com',
      fromName: 'Alice',
      to: 'b@c.com',
      subject: 'HTML Report',
      body: 'Plain text fallback',
      htmlBody: '<h1>Hello</h1><p>World</p>',
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('multipart/alternative');
    expect(decoded).toContain('text/plain; charset="UTF-8"');
    expect(decoded).toContain('text/html; charset="UTF-8"');
    expect(decoded).toContain('Plain text fallback');
    expect(decoded).toContain('<h1>Hello</h1><p>World</p>');
  });

  it('uses nested multipart for HTML + attachments', () => {
    const raw = buildRawEmail({
      from: 'a@b.com',
      fromName: 'Alice',
      to: 'b@c.com',
      subject: 'HTML with attachment',
      body: 'Plain text',
      htmlBody: '<p>HTML body</p>',
      attachments: [
        { filename: 'doc.pdf', mimetype: 'application/pdf', content: Buffer.from('pdf-data') },
      ],
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('multipart/mixed');
    expect(decoded).toContain('multipart/alternative');
    expect(decoded).toContain('text/plain; charset="UTF-8"');
    expect(decoded).toContain('text/html; charset="UTF-8"');
    expect(decoded).toContain('<p>HTML body</p>');
    expect(decoded).toContain('Content-Disposition: attachment; filename="doc.pdf"');
  });

  it('plain text email unchanged when no htmlBody', () => {
    const raw = buildRawEmail({
      from: 'a@b.com',
      fromName: 'A',
      to: 'b@c.com',
      subject: 'Plain',
      body: 'Just text',
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(decoded).not.toContain('multipart/alternative');
    expect(decoded).not.toContain('text/html');
    expect(decoded).toContain('Just text');
  });

  it('encodes non-ASCII subject via RFC 2047', () => {
    const raw = buildRawEmail({
      from: 'a@b.com',
      fromName: 'A',
      to: 'b@c.com',
      subject: 'Résumé',
      body: 'text',
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('=?UTF-8?B?');
  });
});

describe('extractBody', () => {
  it('extracts from simple body.data', () => {
    const data = Buffer.from('Hello world').toString('base64url');
    expect(extractBody({ body: { data } })).toBe('Hello world');
  });

  it('extracts text/plain from multipart', () => {
    const data = Buffer.from('Plain text').toString('base64url');
    expect(
      extractBody({
        parts: [
          { mimeType: 'text/html', body: { data: Buffer.from('<b>HTML</b>').toString('base64url') } },
          { mimeType: 'text/plain', body: { data } },
        ],
      }),
    ).toBe('Plain text');
  });

  it('falls back to text/html when no text/plain', () => {
    const data = Buffer.from('<b>HTML</b>').toString('base64url');
    expect(
      extractBody({
        parts: [{ mimeType: 'text/html', body: { data } }],
      }),
    ).toBe('<b>HTML</b>');
  });

  it('recurses into nested multipart', () => {
    const data = Buffer.from('Nested text').toString('base64url');
    expect(
      extractBody({
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [{ mimeType: 'text/plain', body: { data } }],
          },
        ],
      }),
    ).toBe('Nested text');
  });

  it('returns empty for null payload', () => {
    expect(extractBody(null)).toBe('');
    expect(extractBody(undefined)).toBe('');
  });
});

describe('findAttachments', () => {
  it('finds parts with attachmentId', () => {
    const result = findAttachments([
      { filename: 'doc.pdf', mimeType: 'application/pdf', body: { attachmentId: 'att1', size: 1024 } },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('doc.pdf');
    expect(result[0]).toContain('att1');
  });

  it('skips parts without attachmentId', () => {
    const result = findAttachments([
      { filename: '', body: { data: 'text' } },
    ]);
    expect(result).toHaveLength(0);
  });

  it('recurses into nested parts', () => {
    const result = findAttachments([
      {
        parts: [
          { filename: 'nested.xlsx', mimeType: 'application/xlsx', body: { attachmentId: 'att2', size: 512 } },
        ],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('nested.xlsx');
  });

  it('returns empty for null', () => {
    expect(findAttachments(null)).toHaveLength(0);
    expect(findAttachments(undefined)).toHaveLength(0);
  });
});

describe('loadConfig', () => {
  it('returns parsed config when file exists', () => {
    const config = mockConfig();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config) as unknown as Buffer);

    const result = loadConfig();
    expect(result).toEqual(config);
    expect(fs.existsSync).toHaveBeenCalledWith(
      path.join(CONFIG_DIR, 'email-identities.json'),
    );
  });

  it('returns null when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(loadConfig()).toBeNull();
  });
});

describe('loadOAuthCredentials', () => {
  it('returns credentials with installed format', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes('gcp-oauth.keys.json')) {
        return JSON.stringify({ installed: { client_id: 'cid', client_secret: 'cs' } }) as unknown as Buffer;
      }
      return JSON.stringify({ refresh_token: 'rt' }) as unknown as Buffer;
    });

    const result = loadOAuthCredentials('test');
    expect(result).toEqual({ clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt' });
  });

  it('returns credentials with web format', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes('gcp-oauth.keys.json')) {
        return JSON.stringify({ web: { client_id: 'wid', client_secret: 'ws' } }) as unknown as Buffer;
      }
      return JSON.stringify({ refresh_token: 'wrt' }) as unknown as Buffer;
    });

    const result = loadOAuthCredentials('test');
    expect(result).toEqual({ clientId: 'wid', clientSecret: 'ws', refreshToken: 'wrt' });
  });

  it('returns null when keys file missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(loadOAuthCredentials('test')).toBeNull();
  });

  it('returns null when credentials file missing', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      return String(p).includes('gcp-oauth.keys.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ installed: { client_id: 'x', client_secret: 'y' } }) as unknown as Buffer,
    );
    expect(loadOAuthCredentials('test')).toBeNull();
  });
});

describe('ensureDriveFolder', () => {
  it('returns existing folder ID', async () => {
    mockDriveFilesList.mockResolvedValue({ data: { files: [{ id: 'existing-id' }] } });

    const drive = { files: { list: mockDriveFilesList, create: mockDriveFilesCreate, get: mockDriveFilesGet, export: mockDriveFilesExport } };
    const result = await ensureDriveFolder(drive as any, 'TestFolder');
    expect(result).toBe('existing-id');
    expect(mockDriveFilesCreate).not.toHaveBeenCalled();
  });

  it('creates folder when not found', async () => {
    mockDriveFilesList.mockResolvedValue({ data: { files: [] } });
    mockDriveFilesCreate.mockResolvedValue({ data: { id: 'new-id' } });

    const drive = { files: { list: mockDriveFilesList, create: mockDriveFilesCreate, get: mockDriveFilesGet, export: mockDriveFilesExport } };
    const result = await ensureDriveFolder(drive as any, 'NewFolder');
    expect(result).toBe('new-id');
    expect(mockDriveFilesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ name: 'NewFolder' }),
      }),
    );
  });

  it('includes parentId in query and create', async () => {
    mockDriveFilesList.mockResolvedValue({ data: { files: [] } });
    mockDriveFilesCreate.mockResolvedValue({ data: { id: 'child-id' } });

    const drive = { files: { list: mockDriveFilesList, create: mockDriveFilesCreate, get: mockDriveFilesGet, export: mockDriveFilesExport } };
    await ensureDriveFolder(drive as any, 'Child', 'parent-123');

    expect(mockDriveFilesList).toHaveBeenCalledWith(
      expect.objectContaining({ q: expect.stringContaining("'parent-123' in parents") }),
    );
    expect(mockDriveFilesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ parents: ['parent-123'] }),
      }),
    );
  });
});

describe('getVersionsFolder', () => {
  it('creates NanoClaw/ then filename/ subfolder', async () => {
    let callCount = 0;
    mockDriveFilesList.mockImplementation(async () => {
      callCount++;
      return { data: { files: [] } };
    });
    mockDriveFilesCreate.mockImplementation(async (opts: any) => {
      if (opts.requestBody.name === 'NanoClaw') return { data: { id: 'root-id' } };
      return { data: { id: 'doc-folder-id' } };
    });

    const drive = { files: { list: mockDriveFilesList, create: mockDriveFilesCreate, get: mockDriveFilesGet, export: mockDriveFilesExport } };
    const result = await getVersionsFolder(drive as any, 'report.docx');

    expect(result).toBe('doc-folder-id');
    expect(callCount).toBe(2);
  });
});

describe('handleListIdentities', () => {
  it('returns formatted identity list', async () => {
    mockOAuthFiles();
    const result = await handleListIdentities();
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('personal');
    expect(text).toContain('consulting');
    expect(text).toContain('[default]');
    expect(text).toContain('sends as: alias@biz.com');
  });

  it('returns error when no config', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = await handleListIdentities();
    expect(result.isError).toBe(true);
  });
});

describe('handleSendEmail', () => {
  it('sends email successfully', async () => {
    mockOAuthFiles();
    mockGmailSend.mockResolvedValue({});

    const result = await handleSendEmail({
      identity: 'personal',
      to: 'recipient@test.com',
      subject: 'Test',
      body: 'Hello',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Email sent');
    expect(mockGmailSend).toHaveBeenCalled();
  });

  it('uses sendAs alias when present', async () => {
    mockOAuthFiles();
    mockGmailSend.mockResolvedValue({});

    const result = await handleSendEmail({
      identity: 'consulting',
      to: 'r@t.com',
      subject: 'Test',
      body: 'Hello',
    });

    expect(result.content[0].text).toContain('alias@biz.com');
  });

  it('sends HTML email with html_body parameter', async () => {
    mockOAuthFiles();
    mockGmailSend.mockResolvedValue({});

    const result = await handleSendEmail({
      identity: 'personal',
      to: 'recipient@test.com',
      subject: 'HTML Test',
      body: 'Plain text fallback',
      html_body: '<h1>Report</h1>',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Email sent');
    const rawArg = mockGmailSend.mock.calls[0][0].requestBody.raw;
    const decoded = Buffer.from(rawArg, 'base64url').toString('utf-8');
    expect(decoded).toContain('multipart/alternative');
    expect(decoded).toContain('<h1>Report</h1>');
    expect(decoded).toContain('Plain text fallback');
  });

  it('returns error for unknown identity', async () => {
    mockOAuthFiles();
    const result = await handleSendEmail({
      identity: 'nonexistent',
      to: 'r@t.com',
      subject: 'Test',
      body: 'Hello',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown identity');
  });

  it('returns error when attachment not found', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes('email-identities.json')) return true;
      if (s.includes('gcp-oauth.keys.json')) return true;
      if (s.includes('credentials.json')) return true;
      return false; // attachment not found
    });
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes('email-identities.json')) return JSON.stringify(mockConfig()) as unknown as Buffer;
      if (s.includes('gcp-oauth.keys.json')) return JSON.stringify({ installed: { client_id: 'c', client_secret: 's' } }) as unknown as Buffer;
      return JSON.stringify({ refresh_token: 'r' }) as unknown as Buffer;
    });

    const result = await handleSendEmail({
      identity: 'personal',
      to: 'r@t.com',
      subject: 'Test',
      body: 'Hello',
      attachments: ['missing.docx'],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Attachment not found');
  });

  it('returns error when Gmail API fails', async () => {
    mockOAuthFiles();
    mockGmailSend.mockRejectedValue(new Error('API quota exceeded'));

    const result = await handleSendEmail({
      identity: 'personal',
      to: 'r@t.com',
      subject: 'Test',
      body: 'Hello',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('API quota exceeded');
  });
});

describe('handleSearchMessages', () => {
  it('returns message summaries', async () => {
    mockOAuthFiles();
    mockGmailList.mockResolvedValue({ data: { messages: [{ id: 'msg1' }] } });
    mockGmailGet.mockResolvedValue({
      data: {
        payload: {
          headers: [
            { name: 'From', value: 'sender@test.com' },
            { name: 'Subject', value: 'Test Subject' },
            { name: 'Date', value: '2026-03-25' },
          ],
        },
        snippet: 'Preview text',
      },
    });

    const result = await handleSearchMessages({ identity: 'personal', query: 'test', maxResults: 10 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('msg1');
    expect(result.content[0].text).toContain('sender@test.com');
  });

  it('returns no messages found', async () => {
    mockOAuthFiles();
    mockGmailList.mockResolvedValue({ data: { messages: [] } });

    const result = await handleSearchMessages({ identity: 'personal', query: 'test', maxResults: 10 });
    expect(result.content[0].text).toBe('No messages found.');
  });
});

describe('handleGetMessage', () => {
  it('returns full message with body and attachments', async () => {
    mockOAuthFiles();
    const bodyData = Buffer.from('Email body text').toString('base64url');
    mockGmailGet.mockResolvedValue({
      data: {
        payload: {
          headers: [
            { name: 'From', value: 'sender@test.com' },
            { name: 'To', value: 'me@test.com' },
            { name: 'Subject', value: 'Subject' },
            { name: 'Date', value: '2026-03-25' },
          ],
          body: { data: bodyData },
          parts: [
            { filename: 'report.pdf', mimeType: 'application/pdf', body: { attachmentId: 'att1', size: 2048 } },
          ],
        },
      },
    });

    const result = await handleGetMessage({ identity: 'personal', messageId: 'msg1' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Email body text');
    expect(result.content[0].text).toContain('report.pdf');
  });
});

describe('handleListDriveFiles', () => {
  it('returns formatted file list', async () => {
    mockOAuthFiles();
    mockDriveFilesList.mockResolvedValue({
      data: {
        files: [{ id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf', size: '10240', modifiedTime: '2026-03-25' }],
      },
    });

    const result = await handleListDriveFiles({ identity: 'personal', maxResults: 20 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('doc.pdf');
  });

  it('returns no files found', async () => {
    mockOAuthFiles();
    mockDriveFilesList.mockResolvedValue({ data: { files: [] } });

    const result = await handleListDriveFiles({ identity: 'personal', maxResults: 20 });
    expect(result.content[0].text).toBe('No files found.');
  });
});

describe('handleGetDriveFile', () => {
  it('returns metadata without download', async () => {
    mockOAuthFiles();
    mockDriveFilesGet.mockResolvedValue({
      data: { id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf', size: '5120', modifiedTime: '2026-03-25' },
    });

    const result = await handleGetDriveFile({ identity: 'personal', fileId: 'f1', download: false });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('doc.pdf');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('downloads binary file', async () => {
    mockOAuthFiles();
    mockDriveFilesGet
      .mockResolvedValueOnce({
        data: { id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf', size: '5120', modifiedTime: '2026-03-25' },
      })
      .mockResolvedValueOnce({ data: new ArrayBuffer(8) });

    const result = await handleGetDriveFile({ identity: 'personal', fileId: 'f1', download: true });
    expect(result.content[0].text).toContain('Downloaded:');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('exports Google Doc as PDF', async () => {
    mockOAuthFiles();
    mockDriveFilesGet.mockResolvedValue({
      data: { id: 'f1', name: 'My Doc', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-03-25' },
    });
    mockDriveFilesExport.mockResolvedValue({ data: new ArrayBuffer(8) });

    const result = await handleGetDriveFile({ identity: 'personal', fileId: 'f1', download: true });
    expect(result.content[0].text).toContain('exported as PDF');
    expect(mockDriveFilesExport).toHaveBeenCalled();
  });
});

describe('handleVersionDocument', () => {
  it('uploads file to Drive', async () => {
    mockOAuthFiles();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.createReadStream).mockReturnValue('fake-stream' as any);
    mockDriveFilesList.mockResolvedValue({ data: { files: [{ id: 'root-id' }] } });
    mockDriveFilesCreate
      .mockResolvedValueOnce({ data: { id: 'doc-folder' } }) // subfolder create (may not be called if list finds it)
      .mockResolvedValue({ data: { id: 'version-id', name: 'test.docx_v2026', webViewLink: 'https://link', size: '1024' } });

    // Override to handle both config reads and file exists
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes('email-identities.json')) return JSON.stringify(mockConfig()) as unknown as Buffer;
      if (s.includes('gcp-oauth.keys.json')) return JSON.stringify({ installed: { client_id: 'c', client_secret: 's' } }) as unknown as Buffer;
      return JSON.stringify({ refresh_token: 'r' }) as unknown as Buffer;
    });

    const result = await handleVersionDocument({ identity: 'personal', filename: 'test.docx', note: 'initial' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Version saved to Drive');
  });

  it('returns error when file not found', async () => {
    mockOAuthFiles();
    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes('email-identities.json') || s.includes('gcp-oauth') || s.includes('credentials')) return true;
      return false;
    });

    const result = await handleVersionDocument({ identity: 'personal', filename: 'missing.docx' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('File not found');
  });
});

describe('handleListVersions', () => {
  it('returns version list', async () => {
    mockOAuthFiles();
    mockDriveFilesList
      .mockResolvedValueOnce({ data: { files: [{ id: 'root-id' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'folder-id' }] } })
      .mockResolvedValueOnce({
        data: {
          files: [
            { id: 'v1', name: 'doc_v2026-03-25', description: 'first version', createdTime: '2026-03-25T12:00:00Z', size: '2048' },
          ],
        },
      });

    const result = await handleListVersions({ identity: 'personal', filename: 'doc.docx' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('doc_v2026-03-25');
    expect(result.content[0].text).toContain('first version');
  });

  it('returns no versions found', async () => {
    mockOAuthFiles();
    mockDriveFilesList
      .mockResolvedValueOnce({ data: { files: [{ id: 'root-id' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'folder-id' }] } })
      .mockResolvedValueOnce({ data: { files: [] } });

    const result = await handleListVersions({ identity: 'personal', filename: 'doc.docx' });
    expect(result.content[0].text).toContain('No versions found');
  });
});

describe('handleRestoreDocument', () => {
  it('downloads version and writes to local file', async () => {
    mockOAuthFiles();
    mockDriveFilesGet
      .mockResolvedValueOnce({
        data: { id: 'v1', name: 'doc_v2026-03-25', description: 'first', createdTime: '2026-03-25T12:00:00Z', size: '2048' },
      })
      .mockResolvedValueOnce({ data: new ArrayBuffer(8) });

    const result = await handleRestoreDocument({ identity: 'personal', filename: 'doc.docx', versionId: 'v1' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Restored');
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });
});
