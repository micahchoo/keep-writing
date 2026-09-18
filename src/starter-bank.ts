// What ships in the box. See install.ts for why these are notes and not data.
//
// The files live in `starter/` as real markdown and esbuild inlines them as
// text (esbuild.config.mjs). An Obsidian plugin release carries main.js,
// manifest.json and styles.css and nothing else, so a data file beside them
// would never reach anyone who installs from the community store.

import autobiographical from '../starter/autobiographical.md';
import autoethnographic from '../starter/autoethnographic.md';
import invention from '../starter/invention.md';
import learning from '../starter/learning.md';
import type { StarterNote } from './install';

/**
 * Four notes, grouped by what the ANSWER is rather than by subject. Retrieval
 * of a life already lived; reading a culture through it; what the owner knows
 * and can do; and the prompt, whose answer does not exist until it is
 * written. The last one is kept apart because its rubric contradicts the other
 * three on purpose — a Bank question must be unguessable about one life, a
 * prompt must be open to many readings.
 */
export const STARTER_BANK: StarterNote[] = [
  { name: 'autoethnographic.md', markdown: autoethnographic },
  { name: 'autobiographical.md', markdown: autobiographical },
  { name: 'learning.md', markdown: learning },
  { name: 'invention.md', markdown: invention },
];
