const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

const FIREBASE_PATTERN = {
  group: ['@react-native-firebase/auth', '@react-native-google-signin/*'],
  message: 'Go through src/auth/*.',
};

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: [
      'android/*',
      'ios/*',
      '.expo/*',
      'dist/*',
      'coverage/*',
      'graphify-out/*',
      'src/i18n/generated/*',
      // Copies of the web's Aperture model/math (scripts/sync-photo-fixtures.mjs); linted in the web repo.
      'src/photo/photoTypes.ts',
      'src/photo/colorMath.ts',
      'src/photo/studioColorMath.ts',
      'src/photo/studioLutParser.ts',
      'src/photo/webUniforms.ts',
      'src/photo/curveEdit.ts',
      'src/photo/levelsEdit.ts',
      'src/photo/layerOps.ts',
      'src/photo/goldens.ts',
      'src/photo/maskOps.ts',
      'src/photo/maskAssets.ts',
      'src/photo/brushEngine.ts',
      'src/photo/toolMath.ts',
      'src/photo/geometryOps.ts',
      'src/photo/healOps.ts',
      'src/photo/webMaskPlan.ts',
      'src/photo/webDetailPlan.ts',
      'src/photo/webHistogram.ts',
      'src/photo/presets/index.ts',
      'src/photo/presets/autoPreset.ts',
      'src/photo/presets/userStore.ts',
      'src/photo/fixtures/**',
    ],
  },
  {
    files: ['app/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [FIREBASE_PATTERN],
          paths: [
            {
              name: 'react-native',
              importNames: ['Text', 'Button'],
              message: 'Use Text/Button from src/ui/components instead.',
            },
          ],
        },
      ],
    },
  },
  {
    // MA07: analytics names only via EVENTS.X (src/analytics/events.ts), never an inline literal.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='track'] > Literal:first-child",
          message: 'Use EVENTS.* from src/analytics/events.ts, never an inline event name.',
        },
        {
          selector: "CallExpression[callee.name='track'] > TemplateLiteral:first-child",
          message: 'Use EVENTS.* from src/analytics/events.ts, never an inline event name.',
        },
      ],
    },
  },
  {
    // Firebase is reached only through src/auth/* (MA04 decision 2). Flat config replaces a rule
    // wholesale, so the app/ block repeats the Text/Button restriction.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/auth/**', 'src/features/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [FIREBASE_PATTERN] }] },
  },
]);
