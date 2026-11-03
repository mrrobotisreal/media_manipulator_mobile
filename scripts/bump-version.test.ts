// eslint-disable-next-line @typescript-eslint/no-require-imports
const { bump } = require('./bump-core.cjs') as { bump: (v: string, k: string) => string };

describe('bump-version', () => {
  it('bumps major, minor and patch', () => {
    expect(bump('1.2.3', 'patch')).toBe('1.2.4');
    expect(bump('1.2.3', 'minor')).toBe('1.3.0');
    expect(bump('1.2.3', 'major')).toBe('2.0.0');
  });
  it('rejects unknown kinds and non-semver', () => {
    expect(() => bump('1.2.3', 'huge')).toThrow();
    expect(() => bump('1.2', 'patch')).toThrow();
  });
});
