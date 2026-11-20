// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/captions/legacyRoundTrip.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { studioProjectSchema, studioSaveProjectRequestSchema } from '../studioTypes';

/**
 * ADR-0004 / MM121 decision 2: a pre-MM121 project's caption data parses and re-serialises with no
 * new keys (the API side pins the stored sidecar byte for byte:
 * TestCaptionSidecarLegacyByteStable).
 */
const legacy = {
  id: 'p', name: 'Old', schemaVersion: 3, fps: 30, width: 1920, height: 1080, durationSeconds: 5, tracks: [], revision: 3,
  captions: [{ id: 'c1', startSeconds: 0.5, endSeconds: 2.25, text: 'Hello there' }],
  captionStyle: { fontSizePct: 5.5, color: '#FFCC00', backgroundColor: '#101010', backgroundOpacity: 0.7, position: 'top', maxWidthPct: 80 },
  captionsEnabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

describe('old projects round-trip (MM121)', () => {
  it('captions and caption style come back with exactly the keys they had', () => {
    const p = studioProjectSchema.parse(legacy);
    expect(JSON.stringify(p.captions)).toBe(JSON.stringify(legacy.captions));
    expect(JSON.stringify(p.captionStyle)).toBe(JSON.stringify(legacy.captionStyle));
  });

  it('the save body keeps them byte-identical too', () => {
    const body = studioSaveProjectRequestSchema.safeParse({ name: 'Old', fps: 30, width: 1920, height: 1080, tracks: [], captions: legacy.captions, captionStyle: legacy.captionStyle });
    expect(body.success).toBe(true);
    if (!body.success) return;
    expect(JSON.stringify(body.data.captionStyle)).toBe(JSON.stringify(legacy.captionStyle));
  });
});
