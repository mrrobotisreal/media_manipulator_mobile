import { Text } from 'react-native';

export const appleAuth = {
  isSupported: true,
  performRequest: jest.fn(),
  Operation: { LOGIN: 0 },
  Scope: { EMAIL: 0, FULL_NAME: 1 },
  Error: { CANCELED: '1001' },
};
export const AppleButton = Object.assign(
  ({ buttonText }: { buttonText?: string }) => <Text>{buttonText ?? 'Sign in with Apple'}</Text>,
  { Style: { BLACK: 'Black', WHITE: 'White' }, Type: { CONTINUE: 'Continue' } },
);
export default appleAuth;
