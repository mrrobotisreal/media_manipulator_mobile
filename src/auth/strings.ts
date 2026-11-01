/**
 * Every user-visible auth string, in one place (`app:auth.*` once MA05 wires i18next).
 * The nested shape mirrors the planned `locales/<code>/app.json` `auth` group, so MA05 can move
 * this object into en-US/app.json and swap `authT` for its `t('app:auth.' + key)` without touching
 * callers. Interpolation uses `{{var}}`. Until then the app is English only.
 */
export const authStrings = {
  signIn: {
    title: 'Sign in to Media Manipulator',
    subtitle: 'Use the same account as on media-manipulator.com.',
    apple: 'Continue with Apple',
    google: 'Continue with Google',
    email: 'Sign in with email',
    submit: 'Sign in',
    createAccount: 'Create an account',
    forgot: 'Forgot password?',
    legal: 'By continuing you agree to the {{terms}} and {{privacy}}.',
    terms: 'Terms',
    privacy: 'Privacy Policy',
    unavailable: "Sign-in isn't available in this build.",
    sessionExpired: 'Your session expired. Please sign in again.',
    or: 'or',
  },
  signUp: {
    title: 'Create your account',
    name: 'Name',
    email: 'Email',
    password: 'Password',
    passwordHelper: 'At least 8 characters',
    submit: 'Create account',
    haveAccount: 'Already have an account? Sign in',
  },
  signInForm: {
    email: 'Email',
    password: 'Password',
  },
  reset: {
    title: 'Reset your password',
    body: "Enter your account email and we'll send you a link.",
    email: 'Email',
    submit: 'Send reset link',
    sent: "If an account exists for that email, we've sent a link to reset your password.",
    back: 'Back to sign in',
  },
  errors: {
    invalidCredential: 'Email or password is incorrect.',
    emailInUse: 'An account with this email already exists. Sign in instead.',
    weakPassword: 'Choose a stronger password (at least 8 characters).',
    invalidEmail: 'Enter a valid email address.',
    tooManyRequests: 'Too many attempts. Wait a moment and try again.',
    network: "Can't reach the network. Check your connection and try again.",
    generic: 'Something went wrong. Please try again.',
    nameRequired: 'Enter your name (up to 80 characters).',
    passwordTooShort: 'Password must be at least 8 characters.',
    playServices: 'Google Play services is missing or out of date on this device.',
  },
  link: {
    title: 'Link your accounts',
    body: 'This email is already registered with another sign-in method. Sign in with that method to link them.',
    linked: 'Accounts linked. You can now sign in with either method.',
    linkApple: 'Link Apple',
    linkAppleBody: 'Link your Apple ID so you can sign in with it next time.',
    cancel: 'Cancel',
  },
  verify: {
    banner: 'Verify your email to keep your account secure.',
    send: 'Send link',
    sent: 'Link sent. Check your inbox.',
    dismiss: 'Dismiss',
  },
  sync: {
    loading: 'Loading your account',
    failedTitle: "We couldn't reach your account",
    failedBody: 'Check your connection and try again. Your files and plan are safe.',
    retry: 'Retry',
    signOut: 'Sign out',
  },
  signOut: {
    button: 'Sign out',
    confirmTitle: 'Sign out?',
    confirmBody: 'You can sign back in at any time.',
    confirm: 'Sign out',
    cancel: 'Cancel',
  },
  reauth: {
    title: 'Confirm it is you',
    body: 'For your security, sign in again to continue.',
    password: 'Password',
    withPassword: 'Confirm with password',
    withGoogle: 'Confirm with Google',
    withApple: 'Confirm with Apple',
    cancel: 'Cancel',
  },
} as const;

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type AuthStringKey = Leaves<typeof authStrings>;

/** `authT('signIn.title')`; `{{var}}` placeholders filled from `vars`. MA05 replaces the body with i18next. */
export function authT(key: AuthStringKey, vars?: Record<string, string>): string {
  let node: unknown = authStrings;
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part];
  const text = typeof node === 'string' ? node : key;
  return vars ? text.replace(/\{\{(\w+)\}\}/g, (m, name: string) => vars[name] ?? m) : text;
}
