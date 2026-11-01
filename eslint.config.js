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
    ignores: ['android/*', 'ios/*', '.expo/*', 'dist/*', 'coverage/*', 'graphify-out/*'],
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
    // Firebase is reached only through src/auth/* (MA04 decision 2). Flat config replaces a rule
    // wholesale, so the app/ block repeats the Text/Button restriction.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/auth/**', 'src/features/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [FIREBASE_PATTERN] }] },
  },
]);
