import { redirectSystemPath } from '../app/+native-intent';

const ID = '3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c';
const r = (path: string) => redirectSystemPath({ path, initial: true });

describe('native intent: mediamanipulator://job/<id>', () => {
  it('keeps a UUID job link', () => {
    expect(r(`mediamanipulator://job/${ID}`)).toBe(`mediamanipulator://job/${ID}`);
    expect(r(`/job/${ID}`)).toBe(`/job/${ID}`);
  });
  it('sends an invalid id to Tools', () => {
    expect(r('mediamanipulator://job/not-a-uuid')).toBe('/');
    expect(r('/job/..%2F..')).toBe('/');
    expect(r('/job/')).toBe('/');
  });
  it('still rewrites the share-intent path', () => {
    expect(r('mediamanipulator://dataUrl=abc')).toBe('/intake');
  });
});
