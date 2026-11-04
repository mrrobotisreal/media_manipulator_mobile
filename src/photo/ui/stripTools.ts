/** Design §1 strip: Basic · Colour · Curves · B&W · Masks · Geometry · Heal · Detail · Presets · Layers (+ MA50's Levels, More; MA51's History). Pure (the registry imports it). */
export const STRIP = [
  'basic',
  'color',
  'curves',
  'levels',
  'bw',
  'more',
  'masks',
  'geometry',
  'heal',
  'detail',
  'presets',
  'layers',
  'history',
] as const;
export type StripTool = (typeof STRIP)[number];

export const isStripTool = (v: unknown): v is StripTool =>
  typeof v === 'string' && (STRIP as readonly string[]).includes(v);
