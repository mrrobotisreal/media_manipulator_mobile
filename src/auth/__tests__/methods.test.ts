import { methodFromProviderId, signupSourceFromProviders } from '../methods';

describe('methods', () => {
  it.each([
    ['google.com', 'google'],
    ['password', 'email'],
    ['apple.com', 'apple'],
    ['github.com', 'other'],
    ['phone', 'other'],
  ])('%s -> %s', (id, method) => {
    expect(methodFromProviderId(id)).toBe(method);
  });

  it('cold start uses the first providerData entry, else other', () => {
    expect(signupSourceFromProviders(['apple.com', 'password'])).toBe('apple');
    expect(signupSourceFromProviders([])).toBe('other');
  });
});
