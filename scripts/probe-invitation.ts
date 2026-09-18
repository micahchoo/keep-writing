// Probe: does the Invitation reach the owner's present, where the interviewer
// could only reach the paragraph?
//
// The owner's verdict on drawn Revisits, 2026-09-17: "a lot of them are older
// or produce questions less contextual to who i am rn, some of them are good."
// The cause is structural, not a prompting accident — `FOLLOW_UP_SYSTEM`'s
// whole list of where-to-look aims backward, INTO the text — and 989 of the
// 999 blocks a draw can reach come from finished Pieces, 609 of them from 2020
// or earlier.
//
// Two arms over the same REAL corpus blocks, through the shipped composers:
//   revisit     the interviewer, with framing (`in 2021, in "Koramangala"`)
//   invitation  the seed, no framing, `Lenses/invitation.md` appended
//
// What to look for in the output. An Invitation passes when it could be
// answered today by someone who never wrote the paragraph: no proper noun out
// of the source, no "your"/"you wrote", no year. It fails the same way a
// magazine prompt fails — by being so open it is about nobody.
//
// Usage: bun run scripts/probe-invitation.ts

import { readFileSync } from 'fs';
import { composeInvitation, composeRevisit, type BonsaiConfig, type Fetcher } from '../src/bonsai';
import { bodyOf } from '../src/lens';
import { framingOf } from '../src/paragraphs';

const fetcher: Fetcher = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
  return { status: res.status, text: await res.text() };
};

const cfg: BonsaiConfig = {
  baseUrl: 'http://127.0.0.1:8088/v1',
  model: 'bonsai-2-27b',
  fetcher,
  timeoutMs: 120_000,
};

const VAULT = `${import.meta.dir}/../../../..`;
const lens = (name: string) => {
  try {
    return bodyOf(readFileSync(`${VAULT}/Lenses/${name}.md`, 'utf8'));
  } catch {
    return '';
  }
};

interface Case {
  piece: string;
  title: string;
  date: string;
  publisher?: string;
  id: string;
}

/** Real blocks, spread across the years the draw actually reaches. */
const CASES: Case[] = [
  { piece: '2020-02-01-care-in-collectives', title: 'Care in collectives', date: '2020-02-01', id: 'p-011' },
  {
    piece: '2021-feeling-through-the-cities-koramangala',
    title: 'Feeling Through the Cities: Koramangala',
    date: '2021-01-01',
    publisher: 'Branch Magazine',
    id: 'p-004',
  },
  { piece: '2024-01-01-mapping-history-of-cinema', title: 'Mapping the history of cinema halls', date: '2024-01-01', id: 'p-006' },
];

/** The text of one `^id` block, as the jar would hand it over. */
function block(piece: string, id: string): string | null {
  let lines: string[];
  try {
    lines = readFileSync(`${VAULT}/Pieces/${piece}.md`, 'utf8').split('\n');
  } catch {
    return null;
  }
  const end = lines.findIndex((l) => l.trimEnd().endsWith(`^${id}`));
  if (end < 0) return null;
  let start = end;
  while (start > 0 && (lines[start - 1] ?? '').trim() !== '') start--;
  return lines
    .slice(start, end + 1)
    .join('\n')
    .replace(new RegExp(`\\s*\\^${id}\\s*$`), '')
    .trim();
}

const craft = lens('craft');
const invitation = lens('invitation');
if (!invitation) console.warn('! Lenses/invitation.md not found — the invitation arm runs unsteered\n');

for (const c of CASES) {
  const text = block(c.piece, c.id);
  if (!text) {
    console.log(`\n--- ${c.piece}#^${c.id}: not found, skipped`);
    continue;
  }
  const framing = framingOf(
    c.publisher
      ? { pieceDate: c.date, status: 'published', title: c.title, publisher: c.publisher }
      : { pieceDate: c.date, status: 'published', title: c.title },
  );

  console.log(`\n${'='.repeat(72)}\n${c.piece}#^${c.id}\n${text.slice(0, 300)}${text.length > 300 ? '…' : ''}\n`);

  const revisit = await composeRevisit(cfg, text, framing, [], craft);
  console.log(`  REVISIT     (framing: ${framing})`);
  for (const q of revisit) console.log(`    · ${q.question}`);
  if (revisit.length === 0) console.log('    · (abstained or rejected)');

  const invited = await composeInvitation(cfg, text, [], invitation);
  console.log('  INVITATION  (no framing)');
  for (const q of invited) console.log(`    · ${q.question}`);
  if (invited.length === 0) console.log('    · (abstained or rejected)');
}
