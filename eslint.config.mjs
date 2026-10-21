import js from '@eslint/js';
import globals from 'globals';

/**
 * ESLint flat configuration.
 *
 * The project deliberately has two very different kinds of JavaScript:
 *   - backend/ and scripts/ run on Node.js and use CommonJS
 *   - frontend/ runs in the browser as classic scripts (no bundler)
 *
 * Each gets its own environment and rule set.
 */
export default [
  {
    ignores: ['node_modules/**', 'backend/data/**', 'coverage/**', '*.log'],
  },

  js.configs.recommended,

  // ---------------------------------------------------------------- backend
  {
    files: ['backend/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-return-await': 'error',
      'object-shorthand': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },

  // --------------------------------------------------------------- frontend
  {
    files: ['frontend/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      // Classic script: the frontend is loaded with <script src="..."> and
      // shares its top level scope with the other frontend files.
      sourceType: 'script',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-implicit-globals': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },

  // The eslint config file itself
  {
    files: ['eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
];
