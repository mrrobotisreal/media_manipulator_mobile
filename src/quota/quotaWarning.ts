import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import type { Allowance } from './useAllowance';

/** Decision 5: warn when something is left and it is at most 20 % of the allowance, or the last one. */
export function shouldWarn(limit: number, remaining: number): boolean {
  if (!(limit > 0) || !(remaining > 0)) return false;
  return remaining / limit <= 0.2 || remaining <= 1;
}

const warned = new Set<string>();

/** Test hook: a new app session. */
export function resetQuotaWarnings(): void {
  warned.clear();
}

/** Emits `quota_warning_shown` once per metric per app session. Returns true when it fired. */
export function maybeWarn(allowance: Allowance | null): boolean {
  if (!allowance || allowance.unlimited || warned.has(allowance.metric)) return false;
  if (!shouldWarn(allowance.limit, allowance.remaining)) return false;
  warned.add(allowance.metric);
  track(EVENTS.QUOTA_WARNING_SHOWN, {
    limit: allowance.limit,
    remaining: allowance.remaining,
    scope: allowance.metric,
  });
  return true;
}
