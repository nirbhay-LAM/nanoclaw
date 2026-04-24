import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';

const GROUPS_DIR = path.resolve(
  process.env.GROUPS_DIR || path.join(process.cwd(), 'groups'),
);

/**
 * Load known secrets from credential files across all groups.
 * Returns a Set of strings that should never appear in outgoing messages.
 */
function loadSecrets(): Set<string> {
  const secrets = new Set<string>();

  try {
    const groups = fs.readdirSync(GROUPS_DIR).filter((f) => {
      const stat = fs.statSync(path.join(GROUPS_DIR, f));
      return stat.isDirectory();
    });

    for (const group of groups) {
      // Check for GBP credentials
      const gbpCreds = path.join(GROUPS_DIR, group, 'gbp', 'credentials.json');
      if (fs.existsSync(gbpCreds)) {
        try {
          const data = JSON.parse(fs.readFileSync(gbpCreds, 'utf-8'));
          if (data.password) secrets.add(data.password);
        } catch {
          // Ignore parse errors
        }
      }
    }
  } catch {
    // Ignore directory errors
  }

  return secrets;
}

let knownSecrets: Set<string> | null = null;
let lastLoad = 0;

function getSecrets(): Set<string> {
  const now = Date.now();
  // Reload every 5 minutes to pick up new credential files
  if (!knownSecrets || now - lastLoad > 5 * 60 * 1000) {
    knownSecrets = loadSecrets();
    lastLoad = now;
  }
  return knownSecrets;
}

/**
 * Redact any known secrets from outgoing text.
 * Returns the text with secrets replaced by [REDACTED].
 */
export function redactSecrets(text: string): string {
  const secrets = getSecrets();
  let redacted = text;
  let wasRedacted = false;

  for (const secret of secrets) {
    if (secret.length >= 6 && redacted.includes(secret)) {
      redacted = redacted.replaceAll(secret, '[REDACTED]');
      wasRedacted = true;
    }
  }

  if (wasRedacted) {
    logger.warn('Redacted credentials from outgoing message');
  }

  return redacted;
}
