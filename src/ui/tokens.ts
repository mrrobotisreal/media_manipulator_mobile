/**
 * Darkroom Instrument tokens: the single source for colors, radii, spacing and type.
 * Values mirror media-manipulator-ui/app/globals.css (dark theme). tailwind.config.js
 * imports this file, so the two cannot drift (tokens.test.ts asserts it).
 * Dark is the only v1 theme (ARCHITECTURE §7); keep it behind this theme object.
 */
export const colors = {
  surface0: '#0A0B0D',
  surface1: '#131519',
  surface2: '#1C2026',
  surface3: '#262B33',
  edge: '#2A3038',
  edgeStrong: '#3A424E',
  edgeControl: '#5F636E',
  primary: '#FF6B4A',
  primaryPressed: '#FF8368',
  onPrimary: '#1A0E09',
  data: '#5EEAD4',
  onData: '#04201C',
  premium: '#FFC857',
  onPremium: '#1F1503',
  success: '#4ADE80',
  danger: '#F4525C',
  foreground: '#ECEFF4',
  mutedFg: '#8B95A5',
  subtle: '#5C6675',
} as const;

export const radius = { xs: 2, sm: 4, md: 6, lg: 8, xl: 12 } as const;

export const spacing = { base: 8 } as const;

export const motion = { easing: [0.2, 0, 0, 1], fast: 120, base: 160 } as const;

export const hitTarget = 44;

export const fonts = {
  ui: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
  },
  mono: {
    regular: 'JetBrainsMono_400Regular',
    medium: 'JetBrainsMono_500Medium',
  },
} as const;

/** camelCase token name -> kebab-case Tailwind name (surface0 -> surface-0). */
export function toKebab(name: string): string {
  return name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
}

export const tailwindColors: Record<string, string> = Object.fromEntries(
  Object.entries(colors).map(([k, v]) => [toKebab(k), v]),
);
