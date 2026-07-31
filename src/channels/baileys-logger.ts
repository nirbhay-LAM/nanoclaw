import { logger } from '../logger.js';

/**
 * Warnings Baileys emits for conditions it has already handled internally.
 *
 * "timed out waiting for message" fires when one of the connect-time iq
 * queries (props, blocklist, privacy settings) goes unanswered by WhatsApp.
 * Baileys catches the timeout itself, returns undefined and carries on; this
 * account has logged it once per connect for months with no observable effect.
 *
 * The only lever that would stop the query is `fireInitQueries: false`, but
 * that also skips fetchProps, which persists creds.lastPropHash and is flagged
 * in Baileys as affecting QR scan reliability. Risking re-authentication to
 * silence a handled timeout is a bad trade, so the message is reclassified
 * rather than the connection changed.
 */
const HANDLED_BAILEYS_WARNINGS = ['timed out waiting for message'];

export function isHandledBaileysWarning(text: unknown): boolean {
  return (
    typeof text === 'string' &&
    HANDLED_BAILEYS_WARNINGS.some((known) => text.includes(known))
  );
}

/** Structural match for the ILogger that Baileys expects. */
export interface BaileysLogger {
  level: string;
  child(obj: Record<string, unknown>): BaileysLogger;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

type LoggerLike = Partial<Record<keyof BaileysLogger, unknown>> &
  Pick<BaileysLogger, 'debug' | 'info' | 'warn' | 'error'>;

/**
 * Wrap a logger so known-handled Baileys warnings drop to debug and everything
 * else passes through untouched. Baileys calls child() internally, so the
 * wrapper has to survive being re-derived.
 */
export function wrapBaileysLogger(
  base: LoggerLike = logger as unknown as LoggerLike,
): BaileysLogger {
  return {
    get level(): string {
      return typeof base.level === 'string' ? base.level : 'info';
    },
    child: (obj) =>
      wrapBaileysLogger(
        typeof base.child === 'function'
          ? ((base.child as (o: Record<string, unknown>) => LoggerLike)(
              obj,
            ) as LoggerLike)
          : base,
      ),
    trace: (obj, msg) =>
      typeof base.trace === 'function'
        ? (base.trace as BaileysLogger['trace'])(obj, msg)
        : undefined,
    debug: (obj, msg) => base.debug(obj, msg),
    info: (obj, msg) => base.info(obj, msg),
    error: (obj, msg) => base.error(obj, msg),
    warn: (obj, msg) => {
      // Baileys calls warn(msg) and warn(obj, msg) in different places.
      const text = typeof obj === 'string' ? obj : msg;
      if (isHandledBaileysWarning(text)) {
        base.debug(obj, msg);
        return;
      }
      base.warn(obj, msg);
    },
  };
}
