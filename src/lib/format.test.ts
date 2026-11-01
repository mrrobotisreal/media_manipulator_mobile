import {
  formatBytes,
  formatCountdown,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelative,
} from './format';

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

describe('formatBytes', () => {
  it('uses 1024 base with one decimal under 10 and none from 10', () => {
    expect(formatBytes(0, 'en-US')).toBe('0 B');
    expect(formatBytes(1023, 'en-US')).toBe('1,023 B');
    expect(formatBytes(1536, 'en-US')).toBe('1.5 KB');
    expect(formatBytes(15 * 1024 * 1024, 'en-US')).toBe('15 MB');
    expect(formatBytes(1024 ** 3, 'en-US')).toBe('1 GB');
  });
  it('follows locale separators', () => {
    expect(formatBytes(1536, 'de-DE')).toBe('1,5 KB');
  });
  it('rejects bad input', () => {
    expect(formatBytes(NaN, 'en-US')).toBe('—');
    expect(formatBytes(-1, 'en-US')).toBe('—');
  });
});

describe('formatDuration', () => {
  it('m:ss and h:mm:ss', () => {
    expect(formatDuration(5, 'en-US')).toBe('0:05');
    expect(formatDuration(125, 'en-US')).toBe('2:05');
    expect(formatDuration(3725, 'en-US')).toBe('1:02:05');
    expect(formatDuration(3725, 'de-DE')).toBe('1:02:05');
    expect(formatDuration(125, 'ja-JP')).toBe('2:05');
  });
  it('uses locale digits for ar-SA exactly as Intl does', () => {
    const digit = new Intl.NumberFormat('ar-SA', { useGrouping: false }).format(5);
    expect(formatDuration(5, 'ar-SA')).toContain(digit);
  });
});

describe('numbers and percent', () => {
  it('groups per locale', () => {
    expect(formatNumber(1234567.5, 'en-US')).toBe('1,234,567.5');
    expect(formatNumber(1234567.5, 'de-DE')).toBe('1.234.567,5');
    expect(formatNumber(1234567, 'ja-JP')).toBe('1,234,567');
    expect(formatNumber(1234, 'ar-SA')).toBe(new Intl.NumberFormat('ar-SA').format(1234));
  });
  it('percent', () => {
    expect(formatPercent(0.42, 'en-US')).toBe('42%');
    expect(formatPercent(0.42, 'ja-JP')).toBe('42%');
  });
});

describe('dates', () => {
  it('formats date, time and dateTime per locale', () => {
    const iso = '2026-11-01T15:04:00Z';
    expect(formatDateTime(iso, 'date', 'en-US')).toContain('2026');
    expect(formatDateTime(iso, 'dateTime', 'de-DE')).toContain('2026');
    expect(formatDateTime('nope', 'date', 'en-US')).toBe('—');
  });
  it('relative', () => {
    expect(formatRelative(NOW - 3 * 3600_000, 'en-US', NOW)).toBe('3 hours ago');
    expect(formatRelative(NOW + 2 * 86_400_000, 'en-US', NOW)).toBe('in 2 days');
    expect(formatRelative(NOW - 3 * 3600_000, 'de-DE', NOW)).toBe('vor 3 Stunden');
  });
  it('countdown', () => {
    expect(formatCountdown(NOW + 4 * 3600_000, 'en-US', NOW)).toBe('in 4 hours');
    expect(formatCountdown(NOW + 30 * 60_000, 'en-US', NOW)).toBe('in 30 minutes');
    expect(formatCountdown('bad', 'en-US', NOW)).toBe('');
  });
});
