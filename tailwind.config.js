// Token values live in src/ui/tokens.ts. Node 24 loads erasable TypeScript natively,
// so Tailwind (run by Metro under Node) and the app share one source of truth.
const { tailwindColors, radius, fonts } = require('./src/ui/tokens.ts');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: tailwindColors,
      borderRadius: Object.fromEntries(Object.entries(radius).map(([k, v]) => [k, `${v}px`])),
      fontFamily: {
        sans: [fonts.ui.regular],
        mono: [fonts.mono.regular],
      },
    },
  },
  plugins: [],
};
