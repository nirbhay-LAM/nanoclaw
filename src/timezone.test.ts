import { describe, it, expect } from 'vitest';

import { formatLocalTime, getLocalDateParts } from './timezone.js';

describe('getLocalDateParts', () => {
  it('resolves the date in the given timezone, not UTC', () => {
    const evening = new Date('2026-08-02T01:00:00.000Z'); // 8pm Aug 1 Chicago
    expect(getLocalDateParts('America/Chicago', evening)).toEqual({
      date: '2026-08-01',
      weekday: 'Saturday',
    });
    expect(getLocalDateParts('UTC', evening)).toEqual({
      date: '2026-08-02',
      weekday: 'Sunday',
    });
  });

  it('gets the weekday right for dates the agent previously shifted', () => {
    const cases: Array<[string, string]> = [
      ['2026-08-03', 'Monday'],
      ['2026-08-04', 'Tuesday'],
      ['2026-08-07', 'Friday'],
    ];
    for (const [date, weekday] of cases) {
      // Midday UTC is the same calendar day in Chicago, so this isolates the
      // weekday calculation from any offset effect.
      const parts = getLocalDateParts(
        'America/Chicago',
        new Date(`${date}T15:00:00.000Z`),
      );
      expect(parts).toEqual({ date, weekday });
    }
  });

  it('handles a timezone ahead of UTC crossing midnight', () => {
    const instant = new Date('2026-08-02T16:00:00.000Z'); // 1am Aug 3 in Tokyo
    expect(getLocalDateParts('Asia/Tokyo', instant)).toEqual({
      date: '2026-08-03',
      weekday: 'Monday',
    });
  });
});

// --- formatLocalTime ---

describe('formatLocalTime', () => {
  it('converts UTC to local time display', () => {
    // 2026-02-04T18:30:00Z in America/New_York (EST, UTC-5) = 1:30 PM
    const result = formatLocalTime(
      '2026-02-04T18:30:00.000Z',
      'America/New_York',
    );
    expect(result).toContain('1:30');
    expect(result).toContain('PM');
    expect(result).toContain('Feb');
    expect(result).toContain('2026');
  });

  it('handles different timezones', () => {
    // Same UTC time should produce different local times
    const utc = '2026-06-15T12:00:00.000Z';
    const ny = formatLocalTime(utc, 'America/New_York');
    const tokyo = formatLocalTime(utc, 'Asia/Tokyo');
    // NY is UTC-4 in summer (EDT), Tokyo is UTC+9
    expect(ny).toContain('8:00');
    expect(tokyo).toContain('9:00');
  });
});
