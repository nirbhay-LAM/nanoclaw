import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { formatConversationArchive, writeConversationArchive } from './archive.js';
import type { NewMessage } from './types.js';

const TIMEZONE = 'America/Chicago';
const ASSISTANT_NAME = 'RSK';

function makeMessage(overrides: Partial<NewMessage> & { id: string }): NewMessage {
  return {
    chat_jid: 'group@g.us',
    sender: 'user@s.whatsapp.net',
    sender_name: 'Alice',
    content: 'hello',
    timestamp: '2024-06-15T14:30:00.000Z',
    is_from_me: false,
    ...overrides,
  };
}

// --- formatConversationArchive ---

describe('formatConversationArchive', () => {
  it('formats messages into markdown with header', () => {
    const messages = [
      makeMessage({ id: 'm1', sender_name: 'Alice', content: 'Hello there' }),
      makeMessage({ id: 'm2', sender_name: 'Bob', content: 'Hi back', timestamp: '2024-06-15T14:31:00.000Z' }),
    ];

    const result = formatConversationArchive(messages, '2024-06-15', ASSISTANT_NAME, TIMEZONE);

    expect(result).toContain('# Daily Conversation Archive — 2024-06-15');
    expect(result).toContain('Messages: 2 | Period: last 24h');
    expect(result).toContain('**Alice**');
    expect(result).toContain('Hello there');
    expect(result).toContain('**Bob**');
    expect(result).toContain('Hi back');
  });

  it('uses assistant name for is_from_me messages', () => {
    const messages = [
      makeMessage({ id: 'm1', is_from_me: true, content: 'I am the bot' }),
    ];

    const result = formatConversationArchive(messages, '2024-06-15', ASSISTANT_NAME, TIMEZONE);

    expect(result).toContain(`**${ASSISTANT_NAME}**`);
    expect(result).not.toContain('**Alice**');
  });

  it('falls back to "User" when sender_name is missing', () => {
    const messages = [
      makeMessage({ id: 'm1', sender_name: '', content: 'anon' }),
    ];

    const result = formatConversationArchive(messages, '2024-06-15', ASSISTANT_NAME, TIMEZONE);

    expect(result).toContain('**User**');
  });

  it('formats timestamps in the specified timezone', () => {
    // 2024-06-15T14:30:00Z = 9:30 AM CDT (UTC-5 in June)
    const messages = [
      makeMessage({ id: 'm1', timestamp: '2024-06-15T14:30:00.000Z' }),
    ];

    const result = formatConversationArchive(messages, '2024-06-15', ASSISTANT_NAME, TIMEZONE);

    expect(result).toContain('9:30 AM');
  });

  it('preserves message content exactly', () => {
    const content = 'Line 1\nLine 2\n\nLine 4 with **markdown**';
    const messages = [makeMessage({ id: 'm1', content })];

    const result = formatConversationArchive(messages, '2024-06-15', ASSISTANT_NAME, TIMEZONE);

    expect(result).toContain(content);
  });
});

// --- writeConversationArchive ---

describe('writeConversationArchive', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-archive-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates conversations/ directory and writes file', () => {
    const filename = writeConversationArchive(tmpDir, 'archive content', '2024-06-15');

    expect(filename).toBe('2024-06-15-daily.md');
    const filePath = path.join(tmpDir, 'conversations', filename);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('archive content');
  });

  it('uses unique filename when date file already exists', () => {
    const conversationsDir = path.join(tmpDir, 'conversations');
    fs.mkdirSync(conversationsDir, { recursive: true });
    fs.writeFileSync(path.join(conversationsDir, '2024-06-15-daily.md'), 'existing');

    const filename = writeConversationArchive(tmpDir, 'new content', '2024-06-15');

    expect(filename).not.toBe('2024-06-15-daily.md');
    expect(filename).toMatch(/^2024-06-15-daily-\d+\.md$/);

    // Both files exist
    expect(fs.existsSync(path.join(conversationsDir, '2024-06-15-daily.md'))).toBe(true);
    expect(fs.existsSync(path.join(conversationsDir, filename))).toBe(true);

    // Original untouched
    expect(fs.readFileSync(path.join(conversationsDir, '2024-06-15-daily.md'), 'utf-8')).toBe('existing');
  });

  it('handles nested group path that does not exist yet', () => {
    const deepPath = path.join(tmpDir, 'groups', 'whatsapp_main');
    fs.mkdirSync(deepPath, { recursive: true });

    const filename = writeConversationArchive(deepPath, 'content', '2024-06-15');

    expect(fs.existsSync(path.join(deepPath, 'conversations', filename))).toBe(true);
  });
});
