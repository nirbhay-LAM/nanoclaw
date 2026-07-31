import { describe, it, expect } from 'vitest';
import { shouldColorize } from './logger.js';

describe('shouldColorize', () => {
  it('colorizes for an interactive terminal', () => {
    expect(shouldColorize(true, {})).toBe(true);
  });

  it('does not colorize when stdout is redirected to a file', () => {
    // How the service actually runs: launchd points stdout at logs/nanoclaw.log,
    // so isTTY is undefined and ANSI codes would end up in the file.
    expect(shouldColorize(undefined, {})).toBe(false);
    expect(shouldColorize(false, {})).toBe(false);
  });

  it('honours NO_COLOR even on a terminal', () => {
    expect(shouldColorize(true, { NO_COLOR: '1' })).toBe(false);
  });

  it('honours FORCE_COLOR when redirected', () => {
    expect(shouldColorize(undefined, { FORCE_COLOR: '1' })).toBe(true);
  });

  it('prefers NO_COLOR over FORCE_COLOR', () => {
    expect(shouldColorize(true, { NO_COLOR: '1', FORCE_COLOR: '1' })).toBe(
      false,
    );
  });

  it('ignores empty env values rather than treating them as set', () => {
    expect(shouldColorize(true, { NO_COLOR: '' })).toBe(true);
    expect(shouldColorize(undefined, { FORCE_COLOR: '' })).toBe(false);
  });
});
