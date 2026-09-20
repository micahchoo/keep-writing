import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  { ignores: ['dist/**', 'release/**', 'node_modules/**', 'scripts/**', 'test/**', '*.mjs'] },
  ...obsidianmd.configs.recommended,
  { languageOptions: { parserOptions: { projectService: true } } },
]);
