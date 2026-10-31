// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/** Rendering libraries that the pure game layer must never depend on. */
export const GAME_BANNED_IMPORTS = {
  paths: [
    { name: 'three', message: 'src/game/ and src/ai/ are pure logic: they must not import three.' },
  ],
  patterns: [
    { group: ['three/*', 'three/**'], message: 'src/game/ and src/ai/ are pure logic: they must not import three.' },
    { group: ['**/render/**', '**/scene/**'], message: 'src/game/ and src/ai/ must not depend on render/ or scene/.' },
  ],
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['src/game/**/*.ts', 'src/ai/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', GAME_BANNED_IMPORTS],
    },
  },
);
