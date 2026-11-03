// The Media Manipulator aperture mark as vector data, ported from
// media-manipulator-ui/components/darkroom/aperture-paths.ts (24x24 viewBox, centred at 12,12).
// Barrel: circle r 10, stroke 1.5. Iris opening: flat-top hexagon r 3.9. Six blade bars: stroke 1.5, butt caps.
export const OPENING_BLADES =
  'M15.9 12 L13.95 15.38 L10.05 15.38 L8.1 12 L10.05 8.62 L13.95 8.62 Z';

export const BLADE_SEAMS = [
  'M14.37 7.86 L19.91 17.44',
  'M16.77 11.99 L11.24 21.57',
  'M14.4 16.13 L3.33 16.13',
  'M9.63 16.14 L4.09 6.56',
  'M7.23 12.01 L12.76 2.43',
  'M9.6 7.87 L20.67 7.87',
].join(' ');

export const BARREL_RADIUS = 10;
export const STROKE = 1.5;
/** Outer diameter of the mark in viewBox units (barrel stroke outer edge). */
export const MARK_EXTENT = 2 * (BARREL_RADIUS + STROKE / 2);

export const CORAL = '#FF6B4A';
export const INK = '#0A0B0D';
export const WHITE = '#FFFFFF';

/**
 * SVG fragment of the mark, centred on (cx, cy) with an outer diameter of `diameter` px. Pure fill/stroke (no
 * currentColor) so librsvg renders it identically everywhere.
 */
export function apertureGroup({ cx, cy, diameter, color }) {
  const k = diameter / MARK_EXTENT;
  return (
    `<g transform="translate(${cx} ${cy}) scale(${k}) translate(-12 -12)" color="${color}">` +
    `<circle cx="12" cy="12" r="${BARREL_RADIUS}" fill="none" stroke="${color}" stroke-width="${STROKE}"/>` +
    `<path d="${OPENING_BLADES}" fill="${color}"/>` +
    `<path d="${BLADE_SEAMS}" fill="none" stroke="${color}" stroke-width="${STROKE}"/>` +
    '</g>'
  );
}

export function svgDocument({ width, height, body, background }) {
  const bg = background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `${bg}${body}</svg>`
  );
}
