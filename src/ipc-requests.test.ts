import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { processRequestIpc } from './ipc.js';

// Override GROUPS_DIR used by processRequestIpc
vi.mock('./config.js', () => ({
  DATA_DIR: '',
  GROUPS_DIR: '',
  IPC_POLL_INTERVAL: 50,
  TIMEZONE: 'America/Chicago',
}));

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
