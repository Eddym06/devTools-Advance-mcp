// ESLint 9 flat config. Kept intentionally light (syntactic-only, no
// type-aware project service) so `npm run lint` stays fast and has zero
// setup friction. Tighten rules incrementally as the codebase's `any` usage
// gets typed.
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'package/**', '**/*.d.ts'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The codebase leans on `any` heavily around the CDP client (which is
      // untyped). Revisit once handlers get properly typed args.
      '@typescript-eslint/no-explicit-any': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },
];
