const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: ['android/*', 'ios/*', '.expo/*', 'dist/*', 'coverage/*', 'graphify-out/*', 'src/i18n/generated/*'],
  },
  {
    files: ['app/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
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
]);
