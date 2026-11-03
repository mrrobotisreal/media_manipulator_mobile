import { createHash } from 'node:crypto';
import { sha256Hex } from '../sha256';

describe('sha256Hex', () => {
  it.each([
    '',
    'abc',
    'TypeError: undefined is not a function',
    'x'.repeat(55),
    'x'.repeat(56),
    'x'.repeat(64),
    'x'.repeat(1000),
    'ünïcødé 日本語 🎞️',
  ])('matches node crypto for %j', (s) => {
    expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });
});
