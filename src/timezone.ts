/**
 * The calendar date and weekday *in a given timezone*.
 *
 * Never derive these with `new Date().toISOString().split('T')[0]` or
 * `new Date('2026-08-03').getDay()`. Both work in UTC: an ISO date string is
 * parsed as UTC midnight, which is the previous evening anywhere west of
 * Greenwich, so the weekday comes back one day early. That is silent — no
 * error, just a wrong answer — and it shifts every date derived from it.
 */
export function getLocalDateParts(
  timezone: string,
  now: Date = new Date(),
): { date: string; weekday: string } {
  // en-CA formats as YYYY-MM-DD, and both parts are resolved in `timezone`.
  const date = now.toLocaleDateString('en-CA', { timeZone: timezone });
  const weekday = now.toLocaleDateString('en-US', {
    timeZone: timezone,
    weekday: 'long',
  });
  return { date, weekday };
}

/**
 * Convert a UTC ISO timestamp to a localized display string.
 * Uses the Intl API (no external dependencies).
 */
export function formatLocalTime(utcIso: string, timezone: string): string {
  const date = new Date(utcIso);
  return date.toLocaleString('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
