import type { IntakeFile } from './types';

/**
 * In-memory registry of prepared files, keyed by id. The intake screen registers shared files and
 * the tool screen reads them via the `intake=<ids>` route param. Never persisted.
 */
const files = new Map<string, IntakeFile>();

export function registerIntakeFiles(list: IntakeFile[]): void {
  for (const f of list) files.set(f.id, f);
}

export function getIntakeFiles(ids: readonly string[]): IntakeFile[] {
  return ids.map((id) => files.get(id)).filter((f): f is IntakeFile => Boolean(f));
}

export function forgetIntakeFiles(ids: readonly string[]): void {
  for (const id of ids) files.delete(id);
}

export function clearIntakeSession(): void {
  files.clear();
}
