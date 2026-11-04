/**
 * @jest-environment node
 *
 * The heal mask is an opaque black PNG at exactly the base size with white spots where the strokes
 * went (the API checks the size and reads white = heal).
 */
import { PNG } from 'pngjs';
import { renderHealMaskPng } from '../healMask';
import { loadSkiaApi } from '../testing/skiaTestApi';

jest.setTimeout(60_000);

it('renders strokes white on black at the base size', async () => {
  const api = await loadSkiaApi();
  const bytes = renderHealMaskPng(
    api,
    [
      { pts: [{ x: 100, y: 100 }], diameter: 40 },
      {
        pts: [
          { x: 300, y: 50 },
          { x: 300, y: 250 },
        ],
        diameter: 20,
      },
    ],
    { width: 401, height: 301 },
  );
  const png = PNG.sync.read(Buffer.from(bytes));
  expect([png.width, png.height]).toEqual([401, 301]);
  const at = (x: number, y: number) => png.data[(y * png.width + x) * 4]!;
  const alpha = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3]!;
  expect(at(100, 100)).toBe(255);
  expect(at(100, 125)).toBe(0);
  expect(at(300, 150)).toBe(255);
  expect(at(320, 150)).toBe(0);
  expect(at(10, 290)).toBe(0);
  expect(alpha(10, 290)).toBe(255);
});
