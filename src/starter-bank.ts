// What ships in the box. See install.ts for why these are notes and not data.
//
// The files live in `starter/` as real markdown and esbuild inlines them as
// text (esbuild.config.mjs). An Obsidian plugin release carries main.js,
// manifest.json and styles.css and nothing else, so a data file beside them
// would never reach anyone who installs from the community store.

import autoethnographic from '../starter/autoethnographic.md';
import type { StarterNote } from './install';

export const STARTER_BANK: StarterNote[] = [
  { name: 'autoethnographic.md', markdown: autoethnographic },
];
