import { optionsHash } from '../optionsHash';

describe('optionsHash', () => {
  it('is stable across key order, including nested objects', () => {
    expect(optionsHash({ a: 1, b: { x: 1, y: [1, { q: 1, r: 2 }] } })).toBe(
      optionsHash({ b: { y: [1, { r: 2, q: 1 }], x: 1 }, a: 1 }),
    );
  });
  it('differs when a value differs, ignores undefined, is 8 hex chars', () => {
    expect(optionsHash({ a: 1 })).not.toBe(optionsHash({ a: 2 }));
    expect(optionsHash({ a: 1, b: undefined })).toBe(optionsHash({ a: 1 }));
    expect(optionsHash({ format: 'png' })).toMatch(/^[0-9a-f]{8}$/);
  });
  it('matches FNV-1a 32 reference values (pins the algorithm)', () => {
    expect(optionsHash({})).toBe('5465b825');
    expect(optionsHash({ format: 'png' })).toBe('829a37d3');
  });
});
