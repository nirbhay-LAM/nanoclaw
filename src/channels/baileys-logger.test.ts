import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isHandledBaileysWarning,
  wrapBaileysLogger,
} from './baileys-logger.js';

function makeBase() {
  return {
    level: 'info',
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('isHandledBaileysWarning', () => {
  it('matches the connect-time query timeout', () => {
    expect(isHandledBaileysWarning('timed out waiting for message')).toBe(true);
  });

  it('matches when the text is part of a longer message', () => {
    expect(
      isHandledBaileysWarning('warn: timed out waiting for message!'),
    ).toBe(true);
  });

  it('does not match unrelated warnings', () => {
    expect(
      isHandledBaileysWarning('LIDs are not supported with onWhatsApp'),
    ).toBe(false);
    expect(isHandledBaileysWarning('Connection Closed')).toBe(false);
  });

  it('ignores non-string input', () => {
    expect(isHandledBaileysWarning(undefined)).toBe(false);
    expect(isHandledBaileysWarning({ msgId: '1' })).toBe(false);
  });
});

describe('wrapBaileysLogger', () => {
  let base: ReturnType<typeof makeBase>;

  beforeEach(() => {
    base = makeBase();
  });

  it('demotes the handled timeout to debug, in warn(obj, msg) form', () => {
    // How Baileys actually calls it: logger.warn({ msgId }, 'timed out ...')
    wrapBaileysLogger(base).warn(
      { msgId: '3465.44324-4' },
      'timed out waiting for message',
    );
    expect(base.warn).not.toHaveBeenCalled();
    expect(base.debug).toHaveBeenCalledWith(
      { msgId: '3465.44324-4' },
      'timed out waiting for message',
    );
  });

  it('demotes it in the warn(msg) form too', () => {
    wrapBaileysLogger(base).warn('timed out waiting for message');
    expect(base.warn).not.toHaveBeenCalled();
    expect(base.debug).toHaveBeenCalled();
  });

  it('passes other warnings through untouched', () => {
    wrapBaileysLogger(base).warn('LIDs are not supported with onWhatsApp');
    expect(base.warn).toHaveBeenCalledWith(
      'LIDs are not supported with onWhatsApp',
      undefined,
    );
    expect(base.debug).not.toHaveBeenCalled();
  });

  it('leaves the other levels alone', () => {
    const wrapped = wrapBaileysLogger(base);
    wrapped.info('hello');
    wrapped.error('boom');
    expect(base.info).toHaveBeenCalledWith('hello', undefined);
    expect(base.error).toHaveBeenCalledWith('boom', undefined);
  });

  it('keeps filtering through child loggers', () => {
    // Baileys derives children internally (noise-handler, messages).
    const child = makeBase();
    const withChild = { ...base, child: vi.fn(() => child) };
    const wrapped = wrapBaileysLogger(withChild).child({ class: 'ns' });

    wrapped.warn({ msgId: 'x' }, 'timed out waiting for message');
    expect(child.warn).not.toHaveBeenCalled();
    expect(child.debug).toHaveBeenCalled();

    wrapped.warn('something genuinely wrong');
    expect(child.warn).toHaveBeenCalled();
  });

  it('survives a base logger with no child()', () => {
    const wrapped = wrapBaileysLogger(base).child({ class: 'ns' });
    wrapped.warn('something genuinely wrong');
    expect(base.warn).toHaveBeenCalled();
  });

  it('exposes a level', () => {
    expect(wrapBaileysLogger(base).level).toBe('info');
  });
});
