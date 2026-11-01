import { getActiveLocale } from '@/i18n';

/** Locale-aware formatters over `Intl`. `locale` defaults to the active UI locale. */
const loc = (locale?: string) => locale ?? getActiveLocale();

export function formatNumber(n: number, locale?: string, opts?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(loc(locale), opts).format(n);
}

/** 0..1 -> "42%". */
export function formatPercent(fraction: number, locale?: string): string {
  if (!Number.isFinite(fraction)) return '—';
  return new Intl.NumberFormat(loc(locale), { style: 'percent', maximumFractionDigits: 0 }).format(
    fraction,
  );
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 1024 base; one decimal below 10, none from 10 up (and none for plain bytes). */
export function formatBytes(bytes: number, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < BYTE_UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  const digits = i === 0 || value >= 10 ? 0 : 1;
  const num = new Intl.NumberFormat(loc(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
  return `${num} ${BYTE_UNITS[i]}`;
}

/** `m:ss`, or `h:mm:ss` from one hour. Digits follow the locale's numbering system. */
export function formatDuration(seconds: number, locale?: string): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = new Intl.NumberFormat(loc(locale), { minimumIntegerDigits: 2, useGrouping: false });
  const one = new Intl.NumberFormat(loc(locale), { useGrouping: false });
  return h > 0
    ? `${one.format(h)}:${two.format(m)}:${two.format(s)}`
    : `${one.format(m)}:${two.format(s)}`;
}

export type DateStyle = 'date' | 'time' | 'dateTime';

export function formatDateTime(
  iso: string | number | Date,
  style: DateStyle = 'dateTime',
  locale?: string,
): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opts: Intl.DateTimeFormatOptions =
    style === 'date'
      ? { dateStyle: 'medium' }
      : style === 'time'
        ? { timeStyle: 'short' }
        : { dateStyle: 'medium', timeStyle: 'short' };
  return new Intl.DateTimeFormat(loc(locale), opts).format(d);
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

/** "3 hours ago" / "in 2 days"; `now` is injectable for tests. */
export function formatRelative(
  iso: string | number | Date,
  locale?: string,
  now: number = Date.now(),
): string {
  const at = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  if (Number.isNaN(at)) return '—';
  const diffSec = Math.round((at - now) / 1000);
  const abs = Math.abs(diffSec);
  const [unit, size] = RELATIVE_STEPS.find(([, s]) => abs >= s) ?? ['second', 1];
  const rtf = new Intl.RelativeTimeFormat(loc(locale), { numeric: 'auto' });
  return rtf.format(Math.round(diffSec / size), unit);
}

/** Quota reset: "in 4 hours" (rounded to whole hours, or minutes under an hour). */
export function formatCountdown(
  resetAt: string | number | Date,
  locale?: string,
  now: number = Date.now(),
): string {
  const at = resetAt instanceof Date ? resetAt.getTime() : new Date(resetAt).getTime();
  if (Number.isNaN(at)) return '';
  const minutes = Math.max(1, Math.round((at - now) / 60_000));
  const rtf = new Intl.RelativeTimeFormat(loc(locale), { numeric: 'auto' });
  return minutes < 60
    ? rtf.format(minutes, 'minute')
    : rtf.format(Math.round(minutes / 60), 'hour');
}
