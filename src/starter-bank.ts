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
import ordinaryLife from '../starter/ordinary-life.md';
import type { StarterNote } from './install';

export interface StarterBank extends StarterNote {
  title: string;
  description: string;
}

/** Each bank is installed independently. The owner's installed copy is never overwritten. */
export const STARTER_BANK: StarterBank[] = [
  { name: 'ordinary-life.md', title: 'Ordinary life', description: 'Familiar places, small encounters, things you handle, and whatever holds your attention.', markdown: ordinaryLife },
  { name: 'autobiographical.md', title: 'Autobiographical', description: 'Your experiences, memories, choices, and the ways you have changed.', markdown: autobiographical },
  { name: 'autoethnographic.md', title: 'Autoethnographic', description: 'The customs, relationships, and surroundings that shape your life.', markdown: autoethnographic },
  { name: 'learning.md', title: 'Learning', description: 'What you understand, what you can do, and what you want to find out.', markdown: learning },
  { name: 'invention.md', title: 'Invention', description: 'Open invitations for a story, argument, list, or poem.', markdown: invention },
];
