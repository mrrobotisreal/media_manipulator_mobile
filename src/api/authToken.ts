/**
 * Token provider seam. MA04 registers Firebase's `currentUser?.getIdToken(force)`;
 * until then no Authorization header is sent.
 */
export type IdTokenProvider = (forceRefresh: boolean) => Promise<string | null>;

let provider: IdTokenProvider = () => Promise.resolve(null);

export function setIdTokenProvider(fn: IdTokenProvider): void {
  provider = fn;
}

export async function getIdToken(forceRefresh = false): Promise<string | null> {
  try {
    return await provider(forceRefresh);
  } catch {
    return null;
  }
}
