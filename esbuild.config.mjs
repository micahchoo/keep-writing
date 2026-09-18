import esbuild from 'esbuild';
import process from 'node:process';

const production = process.argv[2] === 'production';

const banner = `/*
keep-writing: built from src/ by esbuild. Do not edit main.js; edit src/ and run npm run build.
*/`;

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
  ],
  format: 'cjs',
  // The starter Bank is bundled as text. An Obsidian plugin release ships
  // main.js, manifest.json and styles.css and nothing else, so a data file
  // beside them would never reach anyone who installs from the community
  // store. See src/starter-bank.ts.
  loader: { '.md': 'text' },
  target: 'es2022',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: false,
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
