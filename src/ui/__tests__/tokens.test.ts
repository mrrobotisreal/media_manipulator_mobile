import { colors, tailwindColors } from '../tokens';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tailwind = require('../../../tailwind.config.js');

describe('tokens', () => {
  it('Tailwind colors equal tokens.ts', () => {
    expect(tailwind.theme.extend.colors).toEqual(tailwindColors);
    expect(Object.keys(tailwindColors)).toHaveLength(Object.keys(colors).length);
  });

  it('uses kebab-case names mirroring the web', () => {
    expect(tailwindColors['surface-0']).toBe('#0A0B0D');
    expect(tailwindColors['edge-strong']).toBe('#3A424E');
    expect(tailwindColors['muted-fg']).toBe('#8B95A5');
    expect(tailwindColors['on-primary']).toBe('#1A0E09');
  });
});
