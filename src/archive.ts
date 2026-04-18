import fs from 'fs';
import path from 'path';

import type { NewMessage } from './types.js';
import { logger } from './logger.js';

/**
 * Format conversation messages into a markdown archive string.
 */
export function formatConversationArchive(
  messages: NewMessage[],
  date: string,
  assistantName: string,
  timezone: string,
): string {
  const lines: string[] = [];
  lines.push(`# Daily Conversation Archive — ${date}`);
  lines.push('');
  lines.push(`Messages: ${messages.length} | Period: last 24h`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
    const sender = msg.is_from_me ? assistantName : (msg.sender_name || 'User');
    lines.push(`**${sender}** (${time}):`);
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Write a conversation archive to the group's conversations/ directory.
 * Returns the filename written, or null if no messages.
 */
export function writeConversationArchive(
  groupPath: string,
  content: string,
  date: string,
): string {
  const conversationsDir = path.join(groupPath, 'conversations');
  fs.mkdirSync(conversationsDir, { recursive: true });

  let filename = `${date}-daily.md`;
  const filePath = path.join(conversationsDir, filename);

  if (fs.existsSync(filePath)) {
    filename = `${date}-daily-${Date.now()}.md`;
  }

  fs.writeFileSync(path.join(conversationsDir, filename), content);
  logger.info({ groupPath, filename }, 'Daily conversation archived');
  return filename;
}
