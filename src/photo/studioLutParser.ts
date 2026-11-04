// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/lutParser.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Minimal Adobe Cube (.cube) 3D LUT parser. Supports LUT_3D_SIZE + the RGB
 * table; DOMAIN_MIN/MAX beyond the [0,1] default and 1D LUTs are ignored
 * (rare for grading). Returns the table quantized to bytes in cube order (red
 * fastest), ready for gl.texImage3D(RGB8) — index i → (r=i%N, g=(i/N)%N,
 * b=i/(N*N)), which maps to texture coords (x=r, y=g, z=b) so the shader can
 * sample texture(uLut, color.rgb) directly.
 */
export interface ParsedLut {
  size: number;
  /** N*N*N*3 bytes, cube order (red fastest) */
  data: Uint8Array;
}

export function parseCubeLut(text: string): ParsedLut {
  let size = 0;
  const entries: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1] ?? '0', 10);
      continue;
    }
    if (line.startsWith('LUT_1D_SIZE')) {
      throw new Error('1D LUTs are not supported');
    }
    if (
      line.startsWith('TITLE') ||
      line.startsWith('DOMAIN_MIN') ||
      line.startsWith('DOMAIN_MAX') ||
      line.startsWith('LUT_3D_INPUT_RANGE')
    ) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        entries.push(r, g, b);
      }
    }
  }
  if (size < 2 || size > 64) {
    throw new Error(`unsupported LUT_3D_SIZE: ${size}`);
  }
  const expected = size * size * size;
  if (entries.length / 3 < expected) {
    throw new Error(`LUT table truncated: expected ${expected} entries, got ${entries.length / 3}`);
  }
  const data = new Uint8Array(expected * 3);
  for (let i = 0; i < expected * 3; i += 1) {
    data[i] = Math.max(0, Math.min(255, Math.round(entries[i] * 255)));
  }
  return { size, data };
}
