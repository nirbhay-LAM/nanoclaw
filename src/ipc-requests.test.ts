import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  processRequestIpc,
  pendingConfirmations,
  checkPendingConfirmations,
} from './ipc.js';

// Override config used by processRequestIpc
vi.mock('./config.js', () => ({
  ASSISTANT_NAME: 'RSK',
  DATA_DIR: '',
  GROUPS_DIR: '',
  IPC_POLL_INTERVAL: 50,
  TIMEZONE: 'America/Chicago',
}));

// Mock getMessagesSince for confirmation tests
vi.mock('./db.js', () => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  getTaskById: vi.fn(),
  updateTask: vi.fn(),
  getMessagesSince: vi.fn().mockReturnValue([]),
}));

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getMessagesSince } from './db.js';

import * as config from './config.js';

let tmpDir: string;
let groupsDir: string;
let groupDir: string;
let responsesDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-ipc-req-test-'));
  groupsDir = path.join(tmpDir, 'groups');
  groupDir = path.join(groupsDir, 'whatsapp_main');
  responsesDir = path.join(tmpDir, 'responses');

  fs.mkdirSync(path.join(groupDir, 'attachments'), { recursive: true });
  fs.mkdirSync(path.join(groupDir, 'files'), { recursive: true });
  fs.mkdirSync(responsesDir, { recursive: true });

  (config as { GROUPS_DIR: string }).GROUPS_DIR = groupsDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readResponse(requestId: string): {
  requestId: string;
  status: string;
  result?: string;
  error?: string;
} {
  const responsePath = path.join(responsesDir, `${requestId}.json`);
  return JSON.parse(fs.readFileSync(responsePath, 'utf-8'));
}

describe('processRequestIpc: transcribe_audio', () => {
  it('writes success response with transcript', async () => {
    const audioPath = path.join(groupDir, 'attachments', 'test.m4a');
    fs.writeFileSync(audioPath, Buffer.from('fake audio data'));

    const transcribeAudio = vi.fn(
      async () => 'Hello world this is a test transcript',
    );
    const requestId = 'req-test-success';

    await processRequestIpc(
      { type: 'transcribe_audio', requestId, filePath: 'attachments/test.m4a' },
      'whatsapp_main',
      responsesDir,
      { transcribeAudio },
    );

    const response = readResponse(requestId);
    expect(response.requestId).toBe(requestId);
    expect(response.status).toBe('success');
    expect(response.result).toBe('Hello world this is a test transcript');
    expect(transcribeAudio).toHaveBeenCalledWith(audioPath);
  });

  it('writes error response for missing file', async () => {
    const transcribeAudio = vi.fn(async () => null);
    const requestId = 'req-test-missing';

    await processRequestIpc(
      {
        type: 'transcribe_audio',
        requestId,
        filePath: 'attachments/nonexistent.m4a',
      },
      'whatsapp_main',
      responsesDir,
      { transcribeAudio },
    );

    const response = readResponse(requestId);
    expect(response.requestId).toBe(requestId);
    expect(response.status).toBe('error');
    expect(response.error).toContain('File not found');
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it('blocks path traversal', async () => {
    const transcribeAudio = vi.fn(async () => null);
    const requestId = 'req-test-traversal';

    await processRequestIpc(
      { type: 'transcribe_audio', requestId, filePath: '../../etc/passwd' },
      'whatsapp_main',
      responsesDir,
      { transcribeAudio },
    );

    const response = readResponse(requestId);
    expect(response.requestId).toBe(requestId);
    expect(response.status).toBe('error');
    expect(response.error).toContain('Path traversal blocked');
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it('handles transcription failure gracefully', async () => {
    const audioPath = path.join(groupDir, 'files', 'bad-audio.mp3');
    fs.writeFileSync(audioPath, Buffer.from('corrupt data'));

    const transcribeAudio = vi.fn(async () => null);
    const requestId = 'req-test-failure';

    await processRequestIpc(
      { type: 'transcribe_audio', requestId, filePath: 'files/bad-audio.mp3' },
      'whatsapp_main',
      responsesDir,
      { transcribeAudio },
    );

    const response = readResponse(requestId);
    expect(response.requestId).toBe(requestId);
    expect(response.status).toBe('error');
    expect(response.error).toContain('Transcription failed');
    expect(transcribeAudio).toHaveBeenCalled();
  });

  it('throws on missing requestId', async () => {
    const transcribeAudio = vi.fn(async () => 'test');

    await expect(
      processRequestIpc(
        { type: 'transcribe_audio', filePath: 'attachments/test.m4a' },
        'whatsapp_main',
        responsesDir,
        { transcribeAudio },
      ),
    ).rejects.toThrow('IPC request missing requestId');
  });

  it('writes response atomically (temp file then rename)', async () => {
    const audioPath = path.join(groupDir, 'attachments', 'atomic.m4a');
    fs.writeFileSync(audioPath, Buffer.from('audio'));

    const transcribeAudio = vi.fn(async () => 'atomic test');
    const requestId = 'req-test-atomic';

    await processRequestIpc(
      {
        type: 'transcribe_audio',
        requestId,
        filePath: 'attachments/atomic.m4a',
      },
      'whatsapp_main',
      responsesDir,
      { transcribeAudio },
    );

    // Response file exists, no .tmp file lingering
    expect(fs.existsSync(path.join(responsesDir, `${requestId}.json`))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(responsesDir, `${requestId}.json.tmp`)),
    ).toBe(false);
  });
});

describe('processRequestIpc: confirm_action', () => {
  afterEach(() => {
    pendingConfirmations.clear();
  });

  it('sends WhatsApp preview and adds to pending map', async () => {
    const sendMessage = vi.fn(async () => {});
    const registeredGroups = vi.fn(() => ({
      'test@g.us': { folder: 'whatsapp_main', isMain: true },
    }));
    const requestId = 'req-confirm-1';

    await processRequestIpc(
      {
        type: 'confirm_action',
        requestId,
        message: 'Confirm this email?',
      } as Parameters<typeof processRequestIpc>[0],
      'whatsapp_main',
      responsesDir,
      { transcribeAudio: undefined, sendMessage, registeredGroups } as any,
    );

    // Should send WhatsApp message
    expect(sendMessage).toHaveBeenCalledWith(
      'test@g.us',
      'Confirm this email?',
    );
    // Should add to pending map, NOT write response
    expect(pendingConfirmations.has(requestId)).toBe(true);
    expect(fs.existsSync(path.join(responsesDir, `${requestId}.json`))).toBe(
      false,
    );
  });

  it('denies when no registered group found', async () => {
    const sendMessage = vi.fn(async () => {});
    const registeredGroups = vi.fn(() => ({}));
    const requestId = 'req-confirm-nogroup';

    await processRequestIpc(
      {
        type: 'confirm_action',
        requestId,
        message: 'Confirm?',
      } as Parameters<typeof processRequestIpc>[0],
      'unknown_group',
      responsesDir,
      { transcribeAudio: undefined, sendMessage, registeredGroups } as any,
    );

    const response = readResponse(requestId);
    expect(response.status).toBe('denied');
    expect(response.error).toContain('Could not find chat');
    expect(pendingConfirmations.has(requestId)).toBe(false);
  });
});

describe('checkPendingConfirmations', () => {
  afterEach(() => {
    pendingConfirmations.clear();
    vi.mocked(getMessagesSince).mockReturnValue([]);
  });

  it('approves on SEND response', async () => {
    const sendMessage = vi.fn(async () => {});
    const requestId = 'req-approve-1';

    pendingConfirmations.set(requestId, {
      chatJid: 'test@g.us',
      sourceGroup: 'whatsapp_main',
      responsesDir,
      requestId,
      sentTimestamp: new Date().toISOString(),
      expireAt: Date.now() + 120_000,
    });

    vi.mocked(getMessagesSince).mockReturnValue([
      { content: 'SEND', is_bot_message: false } as any,
    ]);

    await checkPendingConfirmations({ sendMessage });

    const response = readResponse(requestId);
    expect(response.status).toBe('approved');
    expect(pendingConfirmations.has(requestId)).toBe(false);
  });

  it('approves on YES response (case-insensitive)', async () => {
    const sendMessage = vi.fn(async () => {});
    const requestId = 'req-approve-yes';

    pendingConfirmations.set(requestId, {
      chatJid: 'test@g.us',
      sourceGroup: 'whatsapp_main',
      responsesDir,
      requestId,
      sentTimestamp: new Date().toISOString(),
      expireAt: Date.now() + 120_000,
    });

    vi.mocked(getMessagesSince).mockReturnValue([
      { content: 'yes', is_bot_message: false } as any,
    ]);

    await checkPendingConfirmations({ sendMessage });

    const response = readResponse(requestId);
    expect(response.status).toBe('approved');
  });

  it('denies on CANCEL response', async () => {
    const sendMessage = vi.fn(async () => {});
    const requestId = 'req-deny-1';

    pendingConfirmations.set(requestId, {
      chatJid: 'test@g.us',
      sourceGroup: 'whatsapp_main',
      responsesDir,
      requestId,
      sentTimestamp: new Date().toISOString(),
      expireAt: Date.now() + 120_000,
    });

    vi.mocked(getMessagesSince).mockReturnValue([
      { content: 'CANCEL', is_bot_message: false } as any,
    ]);

    await checkPendingConfirmations({ sendMessage });

    const response = readResponse(requestId);
    expect(response.status).toBe('denied');
    expect(response.error).toContain('Cancelled by user');
    expect(pendingConfirmations.has(requestId)).toBe(false);
  });

  it('denies on timeout and notifies user', async () => {
    const sendMessage = vi.fn(async () => {});
    const requestId = 'req-timeout-1';

    pendingConfirmations.set(requestId, {
      chatJid: 'test@g.us',
      sourceGroup: 'whatsapp_main',
      responsesDir,
      requestId,
      sentTimestamp: new Date().toISOString(),
      expireAt: Date.now() - 1000, // Already expired
    });

    await checkPendingConfirmations({ sendMessage });

    const response = readResponse(requestId);
    expect(response.status).toBe('denied');
    expect(response.error).toContain('timed out');
    expect(pendingConfirmations.has(requestId)).toBe(false);
    expect(sendMessage).toHaveBeenCalledWith(
      'test@g.us',
      expect.stringContaining('timed out'),
    );
  });

  it('ignores unrelated messages', async () => {
    const sendMessage = vi.fn(async () => {});
    const requestId = 'req-ignore-1';

    pendingConfirmations.set(requestId, {
      chatJid: 'test@g.us',
      sourceGroup: 'whatsapp_main',
      responsesDir,
      requestId,
      sentTimestamp: new Date().toISOString(),
      expireAt: Date.now() + 120_000,
    });

    vi.mocked(getMessagesSince).mockReturnValue([
      { content: 'What time is the meeting?', is_bot_message: false } as any,
    ]);

    await checkPendingConfirmations({ sendMessage });

    // Should still be pending
    expect(pendingConfirmations.has(requestId)).toBe(true);
    expect(fs.existsSync(path.join(responsesDir, `${requestId}.json`))).toBe(
      false,
    );
  });

  it('handles concurrent confirmations independently', async () => {
    const sendMessage = vi.fn(async () => {});
    const req1 = 'req-concurrent-1';
    const req2 = 'req-concurrent-2';

    pendingConfirmations.set(req1, {
      chatJid: 'test@g.us',
      sourceGroup: 'whatsapp_main',
      responsesDir,
      requestId: req1,
      sentTimestamp: new Date().toISOString(),
      expireAt: Date.now() + 120_000,
    });
    pendingConfirmations.set(req2, {
      chatJid: 'other@g.us',
      sourceGroup: 'other_group',
      responsesDir,
      requestId: req2,
      sentTimestamp: new Date().toISOString(),
      expireAt: Date.now() + 120_000,
    });

    // Only first group gets SEND
    vi.mocked(getMessagesSince).mockImplementation((chatJid: string) => {
      if (chatJid === 'test@g.us') {
        return [{ content: 'SEND', is_bot_message: false }] as any;
      }
      return [];
    });

    await checkPendingConfirmations({ sendMessage });

    // First approved, second still pending
    const response1 = readResponse(req1);
    expect(response1.status).toBe('approved');
    expect(pendingConfirmations.has(req1)).toBe(false);
    expect(pendingConfirmations.has(req2)).toBe(true);
  });
});
