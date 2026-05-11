import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the filesystem and logger before importing
vi.mock('fs', () => ({
  default: {
    readdirSync: vi.fn(() => ['whatsapp_main']),
    statSync: vi.fn(() => ({ isDirectory: () => true })),
    existsSync: vi.fn((path: string) => path.includes('credentials.json')),
    readFileSync: vi.fn(() =>
      JSON.stringify({
        account: 'test@example.com',
        password: 'secret-password-123',
      }),
    ),
  },
}));

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/test',
  GROUPS_DIR: '/tmp/test/groups',
  IPC_POLL_INTERVAL: 50,
  TIMEZONE: 'America/Chicago',
}));

import { redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it('redacts known passwords from text', () => {
    const text = 'The password is secret-password-123 and it works.';
    const result = redactSecrets(text);
    expect(result).toBe('The password is [REDACTED] and it works.');
    expect(result).not.toContain('secret-password-123');
  });

  it('does not modify text without secrets', () => {
    const text = 'This is a normal message with no secrets.';
    expect(redactSecrets(text)).toBe(text);
  });

  it('redacts multiple occurrences', () => {
    const text = 'First: secret-password-123, second: secret-password-123';
    const result = redactSecrets(text);
    expect(result).toBe('First: [REDACTED], second: [REDACTED]');
  });

  it('ignores short secrets (under 6 chars)', () => {
    // Short strings could cause false positives
    const text = 'The word "test" appears here.';
    expect(redactSecrets(text)).toBe(text);
  });

  it('handles empty text', () => {
    expect(redactSecrets('')).toBe('');
  });
});
