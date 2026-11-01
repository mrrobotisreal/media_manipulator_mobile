import { randomUUID } from 'expo-crypto';

/** UUIDv4; the API's RequestContext accepts UUIDs only. */
export function uuidv4(): string {
  return randomUUID();
}
