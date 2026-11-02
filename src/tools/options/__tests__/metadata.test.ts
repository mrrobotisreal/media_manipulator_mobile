import {
  EDIT_DEFAULTS,
  STRIP_DEFAULTS,
  buildEditOptions,
  buildStripOptions,
  editFormValid,
  prefillFromDocument,
  pruneEmptyValues,
  type EditMetadataForm,
  type StripMetadataForm,
} from '../metadata';
import { TOOL_BY_ID } from '../../registry';
import type { MetadataDocument } from '@/metadata/types';

const strip = (sourceExtension: string, mediaKind: StripMetadataForm['mediaKind']) =>
  buildStripOptions({ ...STRIP_DEFAULTS, sourceExtension, mediaKind });
const edit = (over: Partial<EditMetadataForm>) =>
  buildEditOptions({ ...EDIT_DEFAULTS, sourceExtension: 'jpg', ...over });

describe('strip-metadata goldens', () => {
  it('strip-metadata.jpeg-input', () => {
    expect(strip('jpeg', 'image')).toEqual({
      format: 'jpg',
      quality: 85,
      filter: 'none',
      metadataMode: 'strip',
    });
  });
  it('strip-metadata.heic-input', () => {
    expect(strip('heic', 'image')).toEqual({
      format: 'jpg',
      quality: 85,
      filter: 'none',
      metadataMode: 'strip',
    });
  });
  it('strip-metadata.png', () => {
    expect(strip('png', 'image')).toEqual({
      format: 'png',
      quality: 85,
      filter: 'none',
      metadataMode: 'strip',
    });
  });
  it('strip-metadata.mov', () => {
    expect(strip('mov', 'video')).toEqual({
      format: 'mov',
      quality: 'high',
      speed: 1,
      preserveAspectRatio: true,
      metadataMode: 'strip',
    });
  });
  it('strip-metadata.m4a', () => {
    expect(strip('m4a', 'audio')).toEqual({
      bitrate: '320',
      sampleRate: '44100',
      channels: 'stereo',
      speed: 1,
      volume: 1,
      format: 'aac',
      metadataMode: 'strip',
    });
  });
  it('falls back to mp4 / mp3 for formats the converter cannot write', () => {
    expect(strip('m4v', 'video').format).toBe('mp4');
    expect(strip('wma', 'audio').format).toBe('mp3');
  });
});

describe('edit-metadata goldens', () => {
  it('edit-metadata.text-only (empty fields pruned)', () => {
    expect(edit({ title: ' Sunset ', author: 'Mitch' })).toEqual({
      format: 'jpg',
      quality: 85,
      filter: 'none',
      metadataMode: 'custom',
      metadata: { title: 'Sunset', author: 'Mitch' },
    });
  });
  it('edit-metadata.remove-location', () => {
    expect(edit({ location: 'remove', removeTimestamp: true })).toEqual({
      format: 'jpg',
      quality: 85,
      filter: 'none',
      metadataMode: 'custom',
      gpsOptions: { removeLocationData: true, removeGpsTimestamp: true },
    });
  });
  it('edit-metadata.replace-round', () => {
    expect(
      edit({ location: 'round', latitude: '48.8584', longitude: '2.2945', precisionDecimals: 3 }),
    ).toEqual({
      format: 'jpg',
      quality: 85,
      filter: 'none',
      metadataMode: 'custom',
      gpsOptions: {
        replaceLocationData: true,
        latitude: 48.8584,
        longitude: 2.2945,
        roundLocationPrecision: true,
        precisionDecimals: 3,
      },
    });
  });
  it('replace without rounding sends no precision and keeps altitude', () => {
    expect(
      edit({ location: 'replace', latitude: '1', longitude: '-2', altitude: '35.5' }).gpsOptions,
    ).toEqual({ replaceLocationData: true, latitude: 1, longitude: -2, altitude: 35.5 });
  });
  it('an empty form is custom with nothing to write', () => {
    expect(edit({})).toEqual({
      format: 'jpg',
      quality: 85,
      filter: 'none',
      metadataMode: 'custom',
    });
  });
  it('replace/round need coordinates in range', () => {
    expect(editFormValid({ ...EDIT_DEFAULTS, location: 'replace' })).toBe(false);
    expect(
      editFormValid({ ...EDIT_DEFAULTS, location: 'round', latitude: '91', longitude: '0' }),
    ).toBe(false);
    expect(
      editFormValid({ ...EDIT_DEFAULTS, location: 'round', latitude: '45', longitude: '0' }),
    ).toBe(true);
    expect(editFormValid({ ...EDIT_DEFAULTS, location: 'remove' })).toBe(true);
  });
});

describe('metadataMode rules', () => {
  it('no builder emits custom for non-image input', () => {
    for (const kind of ['video', 'audio'] as const) {
      for (const e of ['mp4', 'mp3', 'm4a', 'mov', 'wav']) {
        expect(strip(e, kind).metadataMode).toBe('strip');
        expect(
          buildEditOptions({ ...EDIT_DEFAULTS, sourceExtension: e, mediaKind: kind }).metadataMode,
        ).toBe('custom');
      }
    }
    // The edit tool only accepts images, so custom can never reach video/audio.
    expect(TOOL_BY_ID.get('edit-metadata')!.accepts.kinds).toEqual(['image']);
    expect(TOOL_BY_ID.get('strip-metadata')!.accepts.kinds).toEqual(['image', 'video', 'audio']);
  });
  it('registry builders produce the same options', () => {
    const t = TOOL_BY_ID.get('strip-metadata')!;
    expect(t.optionsBuilder({ ...t.defaults, sourceExtension: 'png' })).toMatchObject({
      format: 'png',
      metadataMode: 'strip',
    });
  });
});

describe('pruneEmptyValues / prefill', () => {
  it('drops empties recursively', () => {
    expect(pruneEmptyValues({ a: '', b: { c: null, d: 1 }, e: {}, f: [] })).toEqual({
      b: { d: 1 },
      f: [],
    });
  });
  it('prefills text fields and coordinates from an inspected document', () => {
    const doc: MetadataDocument = {
      schemaVersion: 1,
      file: { name: 'a.jpg', sizeBytes: 1, mime: 'image/jpeg', kind: 'image' },
      tools: [],
      warnings: [],
      entries: [
        { id: 'XMP-dc:Title', group: 'XMP-dc', tag: 'Title', value: 'Dusk', category: 'xmp' },
        { id: 'IFD0:Artist', group: 'IFD0', tag: 'Artist', value: 'Alina', category: 'camera' },
        {
          id: 'IPTC:Keywords',
          group: 'IPTC',
          tag: 'Keywords',
          value: ['paris', 'trip'],
          category: 'iptc',
        },
        {
          id: 'Composite:GPSLatitude',
          group: 'Composite',
          tag: 'GPSLatitude',
          value: '48 deg',
          rawValue: 48.858222,
          category: 'gps',
        },
        {
          id: 'Composite:GPSLongitude',
          group: 'Composite',
          tag: 'GPSLongitude',
          value: '2 deg',
          rawValue: 2.2945,
          category: 'gps',
        },
      ],
    };
    expect(prefillFromDocument(doc)).toEqual({
      title: 'Dusk',
      author: 'Alina',
      keywords: 'paris, trip',
      latitude: '48.858222',
      longitude: '2.2945',
    });
  });
});
