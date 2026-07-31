import pino from 'pino';

/**
 * pino-pretty colorizes whatever stdout happens to be. Under launchd stdout is
 * a log file rather than a terminal, so colorizing writes ANSI escape codes
 * into the file itself — it inflates the logs and makes them awkward to grep.
 * Colorize only for an interactive terminal, honouring the usual NO_COLOR and
 * FORCE_COLOR conventions.
 */
export function shouldColorize(
  isTTY: boolean | undefined = process.stdout.isTTY,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR) return true;
  return isTTY === true;
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: shouldColorize() },
  },
});

// Route uncaught errors through pino so they get timestamps in stderr
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
