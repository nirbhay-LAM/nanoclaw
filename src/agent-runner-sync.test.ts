import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Deliberately does NOT mock 'fs' — this exercises real filesystem behaviour.
// container-runner.test.ts stubs fs for the spawn tests, which is why these
// live in their own file.
vi.mock('./config.js', () => ({
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000,
  CREDENTIAL_PROXY_PORT: 3001,
  DATA_DIR: '/tmp/nanoclaw-test-data',
  GROUPS_DIR: '/tmp/nanoclaw-test-groups',
  IDLE_TIMEOUT: 1800000,
  TIMEZONE: 'America/Los_Angeles',
}));

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { syncAgentRunnerSource, diffHashes } from './container-runner.js';

describe('syncAgentRunnerSource', () => {
  let root: string;
  let source: string;
  let group: string;

  const write = (dir: string, name: string, body: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  };
  const read = (dir: string, name: string): string =>
    fs.readFileSync(path.join(dir, name), 'utf-8');
  const manifest = (dir: string): string =>
    path.join(dir, '.source-manifest.json');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-runner-sync-'));
    source = path.join(root, 'source');
    group = path.join(root, 'group');
    write(source, 'index.ts', 'v1');
    write(source, 'ipc.ts', 'ipc-v1');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('seeds a missing copy and records a manifest', () => {
    expect(syncAgentRunnerSource(source, group)).toBe('seeded');
    expect(read(group, 'index.ts')).toBe('v1');
    expect(fs.existsSync(manifest(group))).toBe(true);
  });

  it('re-syncs an untouched copy when the source changes', () => {
    syncAgentRunnerSource(source, group);
    write(source, 'index.ts', 'v2');

    // The regression this exists to prevent: the copy stayed on April source
    // for four months because it was only ever seeded once.
    expect(syncAgentRunnerSource(source, group)).toBe('synced');
    expect(read(group, 'index.ts')).toBe('v2');
  });

  it('is a no-op when the copy already matches the source', () => {
    syncAgentRunnerSource(source, group);
    expect(syncAgentRunnerSource(source, group)).toBe('up-to-date');
  });

  it('never overwrites a customised copy', () => {
    syncAgentRunnerSource(source, group);
    write(group, 'index.ts', 'local edit');
    write(source, 'index.ts', 'v2');

    expect(syncAgentRunnerSource(source, group)).toBe('customized');
    expect(read(group, 'index.ts')).toBe('local edit');
  });

  it('keeps reporting a customised copy rather than going quiet', () => {
    syncAgentRunnerSource(source, group);
    write(group, 'index.ts', 'local edit');
    expect(syncAgentRunnerSource(source, group)).toBe('customized');
    expect(syncAgentRunnerSource(source, group)).toBe('customized');
  });

  it('adopts a pre-manifest copy that still matches the source', () => {
    // Copies seeded before manifests existed must not be flagged forever.
    fs.cpSync(source, group, { recursive: true });
    expect(syncAgentRunnerSource(source, group)).toBe('adopted');
    expect(fs.existsSync(manifest(group))).toBe(true);

    // Having adopted it, later source changes flow through normally.
    write(source, 'index.ts', 'v2');
    expect(syncAgentRunnerSource(source, group)).toBe('synced');
    expect(read(group, 'index.ts')).toBe('v2');
  });

  it('treats a differing pre-manifest copy as customised', () => {
    fs.cpSync(source, group, { recursive: true });
    write(group, 'index.ts', 'local edit');
    expect(syncAgentRunnerSource(source, group)).toBe('customized');
    expect(read(group, 'index.ts')).toBe('local edit');
  });

  it('detects added and removed files, not just edits', () => {
    syncAgentRunnerSource(source, group);

    write(group, 'extra.ts', 'added locally');
    expect(syncAgentRunnerSource(source, group)).toBe('customized');

    fs.rmSync(path.join(group, 'extra.ts'));
    fs.rmSync(path.join(group, 'ipc.ts'));
    expect(syncAgentRunnerSource(source, group)).toBe('customized');
  });

  it('picks up changes in nested directories', () => {
    write(source, 'tools/helper.ts', 'h1');
    expect(syncAgentRunnerSource(source, group)).toBe('seeded');

    write(source, 'tools/helper.ts', 'h2');
    expect(syncAgentRunnerSource(source, group)).toBe('synced');
    expect(read(group, 'tools/helper.ts')).toBe('h2');
  });

  it('ignores the manifest itself when comparing', () => {
    syncAgentRunnerSource(source, group);
    // The manifest lives inside the copy; it must not read as a local edit.
    expect(syncAgentRunnerSource(source, group)).toBe('up-to-date');
  });

  it('reports no-source when the repo directory is absent', () => {
    expect(syncAgentRunnerSource(path.join(root, 'nope'), group)).toBe(
      'no-source',
    );
  });
});

describe('diffHashes', () => {
  it('lists changed, added and removed entries', () => {
    expect(
      diffHashes({ a: '1', b: '2', c: '3' }, { a: '1', b: 'X', d: '4' }),
    ).toEqual(['b', 'c', 'd']);
  });

  it('returns nothing for identical trees', () => {
    expect(diffHashes({ a: '1' }, { a: '1' })).toEqual([]);
  });
});
