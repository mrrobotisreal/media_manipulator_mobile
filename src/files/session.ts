import type { IntakeFile, Rejection } from './types';

/**
 * In-memory registry for the current intake batch (shared files and their refusals) and any files
 * handed to a tool screen by id. Never persisted: a pending share is held in memory only.
 */
const files = new Map<string, IntakeFile>();
let batch: IntakeBatch | null = null;

export interface IntakeBatch {
  files: IntakeFile[];
  rejected: Rejection[];
}

export function setIntakeBatch(next: IntakeBatch | null): void {
  batch = next;
  for (const f of next?.files ?? []) files.set(f.id, f);
}

export function getIntakeBatch(): IntakeBatch | null {
  return batch;
}

export function getIntakeFiles(ids: readonly string[]): IntakeFile[] {
  return ids.map((id) => files.get(id)).filter((f): f is IntakeFile => Boolean(f));
}

export function clearIntakeSession(): void {
  files.clear();
  batch = null;
}
