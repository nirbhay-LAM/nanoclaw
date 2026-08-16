import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

/**
 * Operator alerts for conditions the assistant cannot report itself.
 *
 * When WhatsApp logs out there is no channel left to tell anyone through — the
 * one time an alert matters most is the one time the usual path is gone. A
 * logout in August went unnoticed for four and a half hours because the process
 * exited quietly and nothing surfaced it.
 */

/**
 * Resolved lazily rather than at module load. Importing this module must not
 * depend on config being fully populated — otherwise any test that mocks
 * config without DATA_DIR fails to even load its subject under test.
 */
function alertStateFile(): string {
  return path.join(DATA_DIR, 'alert-state.json');
}

/** Long enough that a respawn loop cannot spam, short enough to catch someone returning to their desk. */
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

type AlertState = Record<string, number>;

function readState(): AlertState {
  try {
    return JSON.parse(fs.readFileSync(alertStateFile(), 'utf-8')) as AlertState;
  } catch {
    return {};
  }
}

function writeState(state: AlertState): void {
  try {
    const file = alertStateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
  } catch (err) {
    logger.warn({ err }, 'Could not persist alert state');
  }
}

/**
 * Escape a string for embedding in an AppleScript double-quoted literal.
 * The message can carry an error string, so it is not assumed to be safe.
 */
export function escapeAppleScript(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
}

/** True when this key has not alerted inside the cooldown window. */
export function shouldAlert(
  key: string,
  now: number,
  state: AlertState,
  cooldownMs = DEFAULT_COOLDOWN_MS,
): boolean {
  const last = state[key];
  return typeof last !== 'number' || now - last >= cooldownMs;
}

export interface AlertOptions {
  /** Groups repeat alerts. Defaults to the title. */
  key?: string;
  cooldownMs?: number;
  /** Injectable for tests. */
  now?: number;
}

/**
 * Raise a desktop alert and record it in the log.
 *
 * Deliberately fire-and-forget: an alert failing must never take down the
 * caller, which is usually already handling a failure of its own.
 */
export function alertOperator(
  title: string,
  message: string,
  opts: AlertOptions = {},
): boolean {
  const key = opts.key ?? title;
  const now = opts.now ?? Date.now();
  const state = readState();

  if (!shouldAlert(key, now, state, opts.cooldownMs)) {
    logger.debug({ key }, 'Alert suppressed by cooldown');
    return false;
  }

  logger.error({ alert: key }, message);

  const safeTitle = escapeAppleScript(title);
  const safeMessage = escapeAppleScript(message);
  exec(
    `osascript -e 'display notification "${safeMessage}" with title "${safeTitle}" sound name "Basso"'`,
    (err) => {
      if (err) logger.warn({ err }, 'Desktop alert failed');
    },
  );

  state[key] = now;
  writeState(state);
  return true;
}

/** Clear a key so the next occurrence alerts immediately rather than waiting out the cooldown. */
export function clearAlert(key: string): void {
  const state = readState();
  if (state[key] === undefined) return;
  delete state[key];
  writeState(state);
}
