// Probe: run the shipped furniture test over the real corpus in Pieces/.
// Reports what the jar loses, by species, and shows a sample of each, so the
// floor can be re-judged against the writing rather than against a number.
//
// Usage: bun run scripts/probe-furniture.ts [--kept]

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_PROSE_WORDS, proseOf, readsAsParagraph } from '../src/furniture';

const PIECES = join(import.meta.dir, '../../../../Pieces');
const ID_AT_END = /\s\^[A-Za-z0-9-]+\s*$/;

interface Block { file: string; text: string; heading: string }

const blocks: Block[] = [];
for (const name of readdirSync(PIECES).filter((f) => f.endsWith('.md'))) {
  const src = readFileSync(join(PIECES, name), 'utf-8');
  // status: page is site furniture already, and is never drawn.
  if (/^status:\s*page\s*$/m.test(src)) continue;
  let heading = '';
  for (const line of src.split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) heading = (h[1] as string).trim().toLowerCase();
    if (ID_AT_END.test(line)) blocks.push({ file: name, text: line.replace(ID_AT_END, '').trim(), heading });
  }
}

const why = (b: Block): string => {
  const prose = proseOf(b.text);
  const words = prose.split(' ').filter(Boolean).length;
  if (!prose) return 'nothing but markup';
  if (words >= MIN_PROSE_WORDS && !readsAsParagraph(b.text, b.heading)) {
    return b.heading && !readsAsParagraph(b.text, '') ? 'caption or field' : 'under a furniture heading';
  }
  if (!readsAsParagraph(b.text, b.heading)) return `under the floor (${words}w)`;
  return '';
};

const strained = blocks.filter((b) => !readsAsParagraph(b.text, b.heading));
const counts = new Map<string, Block[]>();
for (const b of strained) {
  const k = why(b).replace(/\(\d+w\)/, `(<${MIN_PROSE_WORDS}w)`);
  counts.set(k, [...(counts.get(k) ?? []), b]);
}

console.log(`Pieces/ blocks with an id, page excluded: ${blocks.length}`);
console.log(`the jar keeps ${blocks.length - strained.length}, strains ${strained.length} (${((100 * strained.length) / blocks.length).toFixed(1)}%)\n`);
for (const [k, list] of [...counts].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(4)}  ${k}`);
  for (const b of list.slice(0, 4)) console.log(`        | ${b.text.slice(0, 84)}`);
}

if (process.argv.includes('--kept')) {
  console.log('\n--- shortest blocks the jar KEEPS (check the floor is not too low) ---');
  const kept = blocks.filter((b) => readsAsParagraph(b.text, b.heading));
  for (const b of kept.sort((a, z) => proseOf(a.text).length - proseOf(z.text).length).slice(0, 12)) {
    console.log(`  ${b.text.slice(0, 92)}`);
  }
}

// The second strain: the corpus keeps every telling of a Piece, so the same
// words reach the jar under two refs. paragraphJar#oneTellingEach makes two
// tellings one paragraph.
const kept = blocks.filter((b) => readsAsParagraph(b.text, b.heading));
const byText = new Map<string, string[]>();
for (const b of kept) byText.set(b.text, [...(byText.get(b.text) ?? []), b.file]);
const retold = [...byText].filter(([, files]) => files.length > 1);
const slots = retold.reduce((n, [, f]) => n + f.length, 0);
console.log(`\n--- second tellings ---`);
console.log(`prose blocks: ${kept.length}`);
console.log(`  texts told more than once: ${retold.length}, taking ${slots} slots (${((100 * slots) / kept.length).toFixed(1)}%)`);
console.log(`  the jar keeps ${kept.length - (slots - retold.length)} after oneTellingEach`);
for (const [t, files] of retold.slice(0, 3)) {
  console.log(`    "${t.slice(0, 58)}..."`);
  for (const f of files) console.log(`        ${f}`);
}
