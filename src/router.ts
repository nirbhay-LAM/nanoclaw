import { Channel, NewMessage } from './types.js';
import { formatLocalTime, getLocalDateParts } from './timezone.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(
  messages: NewMessage[],
  timezone: string,
  now: Date = new Date(),
): string {
  const lines = messages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}">${escapeXml(m.content)}</message>`;
  });

  // State the date outright rather than leaving the agent to infer it from
  // message timestamps and work out the weekday itself. Both of those are
  // error-prone: the session's start date drifts once a container lives past
  // midnight, and weekday arithmetic on a date string silently resolves in UTC
  // (see getLocalDateParts), which shifts every derived date a day late. This
  // header is recomputed on the host for every turn, so it cannot drift.
  const { date, weekday } = getLocalDateParts(timezone, now);
  const header = `<context timezone="${escapeXml(timezone)}" today="${escapeXml(date)}" weekday="${escapeXml(weekday)}" />\n`;

  return `${header}<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  return text;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
