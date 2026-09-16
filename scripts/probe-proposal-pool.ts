// Probe: what is in the Proposal pool, and what does the lexical finder
// actually surface? `pool.ts#blockPool` takes every block with an id outside
// Bank/ and Templates/ — the paragraph jar's furniture test never runs on it.
//
// Usage: bun run scripts/probe-proposal-pool.ts
//
// Read alongside scripts/probe-furniture.ts, which measures the same corpus
// through the jar's test.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findCandidates, type Block } from '../src/lexical';
import { isFurniture, readsAsParagraph } from '../src/paragraphs';

const VAULT = join(import.meta.dir, '../../../..');
const SKIP = new Set(['Bank', 'Templates', '.obsidian', '.smart-env', '.trash', '.bin', 'node_modules']);
const ID_AT_END = /\s\^([A-Za-z0-9-]+)\s*$/;

interface Entry extends Block { file: string; heading: string }

function walk(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, r));
    else if (name.endsWith('.md')) out.push(r);
  }
  return out;
}

const pool: Entry[] = [];
for (const rel of walk(VAULT)) {
  let heading = '';
  for (const line of readFileSync(join(VAULT, rel), 'utf-8').split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) heading = (h[1] as string).trim().toLowerCase();
    const m = ID_AT_END.exec(line);
    if (m) pool.push({ ref: `${rel.replace(/\.md$/, '')}#^${m[1]}`, text: line.replace(ID_AT_END, '').trim(), file: rel, heading });
  }
}

// Two different standards, on purpose (paragraphs.ts): the pool drops
// furniture; only the draw adds the word floor on top.
const furniture = pool.filter((b) => isFurniture(b.text, b.heading));
const belowFloor = pool.filter((b) => !isFurniture(b.text, b.heading) && !readsAsParagraph(b.text, b.heading));
console.log(`blocks with an id outside Bank/ and Templates/: ${pool.length}`);
console.log(`  furniture, kept out of the pool:  ${furniture.length} (${((100 * furniture.length) / pool.length).toFixed(1)}%)`);
console.log(`  short but real, KEPT in the pool: ${belowFloor.length} (the draw would refuse these)\n`);
for (const b of furniture.slice(0, 4)) console.log(`    out | ${b.text.slice(0, 74)}`);
for (const b of belowFloor.slice(0, 3)) console.log(`   kept | ${b.text.slice(0, 74)}`);
const live = pool.filter((b) => !isFurniture(b.text, b.heading));

// Real answers from real Sittings.
const ANSWERS = [
  'I think suffering from bipolar greatly enhanced my magnetic connection with my bed. When we moved into the new home in Dapodi, it became the way that I processed the day. Door-locked and horizontal.',
  'Since I have moved to the US, the becoming of an adult in terms of managing my own motivational well has been the hardest thing to do. In India, I often worked as a weather vane.',
  'I have been mapping the cinema halls of a city, georeferencing an old survey map against the basemap, and the archive kept refusing to line up with what people remembered.',
];

console.log('\n--- what the lexical finder surfaces (top 5 per answer) ---');
for (const a of ANSWERS) {
  console.log(`\nanswer: ${a.slice(0, 72)}...`);
  for (const c of findCandidates(a, live, 5)) {
    console.log(`     ${c.ref.slice(0, 46).padEnd(46)} | ${c.text.slice(0, 62)}`);
  }
}
