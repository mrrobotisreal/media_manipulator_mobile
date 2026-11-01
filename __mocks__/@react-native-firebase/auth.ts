/* Jest manual mock for the modular @react-native-firebase/auth API (auto-applied: sits next to node_modules). */
const mockAuth: { currentUser: unknown } = { currentUser: null };

export const getAuth = jest.fn(() => mockAuth);
export const onAuthStateChanged = jest.fn((_auth: unknown, _cb: unknown) => jest.fn());
export const signInWithCredential = jest.fn();
export const signInWithEmailAndPassword = jest.fn();
export const createUserWithEmailAndPassword = jest.fn();
export const signInWithPopup = jest.fn();
export const linkWithCredential = jest.fn();
export const linkWithPopup = jest.fn();
export const reauthenticateWithCredential = jest.fn();
export const reauthenticateWithPopup = jest.fn();
export const sendPasswordResetEmail = jest.fn();
export const sendEmailVerification = jest.fn();
export const fetchSignInMethodsForEmail = jest.fn();
export const updateProfile = jest.fn();
export const reload = jest.fn();
export const getIdToken = jest.fn();
export const signOut = jest.fn();
export const getAdditionalUserInfo = jest.fn(
  (cred: { additionalUserInfo?: unknown }) => cred?.additionalUserInfo ?? null,
);

export const GoogleAuthProvider = {
  credential: jest.fn((idToken: string) => ({ providerId: 'google.com', token: idToken })),
};
export const EmailAuthProvider = {
  credential: jest.fn((email: string, password: string) => ({
    providerId: 'password',
    email,
    password,
  })),
};
export class OAuthProvider {
  scopes: string[] = [];
  constructor(public providerId: string) {}
  addScope(scope: string) {
    this.scopes.push(scope);
    return this;
  }
  credential(params: Record<string, unknown>) {
    return { providerId: this.providerId, ...params };
  }
}
