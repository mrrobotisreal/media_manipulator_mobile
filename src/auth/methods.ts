/** Auth method vocabulary shared by analytics, sync and the UI. */
export type AuthMethod = 'google' | 'email' | 'apple';
/** What `POST /account/sync` accepts as `signupSource` (MA08 allowlist). */
export type SignupSource = AuthMethod | 'other';

export const PROVIDER_IDS = {
  google: 'google.com',
  email: 'password',
  apple: 'apple.com',
} as const satisfies Record<AuthMethod, string>;

/** Firebase `providerId` to our method; anything else (phone, github, ...) is `other`. */
export function methodFromProviderId(providerId: string): SignupSource {
  switch (providerId) {
    case 'google.com':
      return 'google';
    case 'password':
      return 'email';
    case 'apple.com':
      return 'apple';
    default:
      return 'other';
  }
}

/** Cold start: the first `providerData` entry decides the signup source. */
export function signupSourceFromProviders(providerIds: readonly string[]): SignupSource {
  const first = providerIds[0];
  return first ? methodFromProviderId(first) : 'other';
}
