// Probe: a Revisit drawn from a Sitting answer, through the SHIPPED code.
//
// Checked 2026-09-16 and reported back: a Sitting Revisit is NOT contextless
// the way a mid-essay Piece paragraph was. A Sitting answer is self-contained
// first-person prose, so the blind question is already grounded. Two real
// defects were found instead, and this probe holds both:
//
//   1. the framing of a renamed Sitting ("in a Sitting on Suffering a
//      Repitition"), now said as a name;
//   2. the Revisit never being measured against what was already asked from
//      the block, now threaded as `asked`.
//
// It also shows why the question is NOT put in the framing: with it, the
// Revisit composes very nearly the Follow-up that was already offered.
//
// Usage: bun run scripts/probe-sitting-context.ts

import { checkRevisit, composeFollowUps, composeRevisit, type BonsaiConfig, type Fetcher } from '../src/bonsai';
import { sittingFraming } from '../src/paragraphs';

const fetcher: Fetcher = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
  return { status: res.status, text: await res.text() };
};

const cfg: BonsaiConfig = { baseUrl: 'http://127.0.0.1:8088/v1', model: 'bonsai-2-27b', fetcher, timeoutMs: 120_000 };

interface Case { sitting: string; asked: string; answer: string; fresh: string }

const CASES: Case[] = [
  {
    sitting: 'Suffering a Repitition',
    asked: 'What is one condition you repeat that you wish you could stop doing, and what happens when you try to break that cycle?',
    fresh: 'What did the bed give you that people could not?',
    answer:
      'I think suffering from bipolar greatly enhanced my magnetic connection with my bed. I was always a child that also liked the bed, it made sensory sense. I felt at peace when lying down. I could have my internal monologues and internal world-building in peace. I was also not allowed to be an extrovert as a child, my parents were trying to protect me from going down the "wrong" path I think. Or they were first time parents and caution was their only tool and I was the caution-shaped nail.',
  },
  {
    sitting: 'Not ready for?',
    asked: 'In what areas of your life or work are you being called to evolve faster than you feel ready for?',
    fresh: 'What did the weather vane point at that you would not have chosen?',
    answer:
      'Since I have moved to the US, the becoming of an adult in terms of managing my own motivational well has been the hardest thing to do. In India, I often worked as a weather vane. I would get into situations and groups with interesting ideas, and find inspirations and motivations from there. I don’t feel ready for the onus of my own health and my social life',
  },
];

for (const c of CASES) {
  console.log(`\n${'='.repeat(78)}\nSITTING  ${c.sitting}\nasked    ${c.asked}\n${'='.repeat(78)}`);

  const was = `in a Sitting on ${c.sitting}`;
  const now = sittingFraming(c.sitting);
  console.log(`\n  framing was : "${was}"`);
  console.log(`  framing now : "${now}"`);

  console.log(`\n  REVISIT, shipped (new framing, asked set threaded)`);
  for (const q of await composeRevisit(cfg, c.answer, now, [c.asked])) console.log(`      * ${q.question}`);

  // The guard, exercised directly: the question already asked from this block
  // must not come back as a Revisit candidate.
  const guarded = checkRevisit({ questions: [c.asked, c.fresh] }, c.answer, [c.asked]);
  const kept = guarded.kind === 'ok' ? guarded.value.map((v) => v.question) : [];
  console.log(`\n  GUARD   fed the already-asked question + a fresh one -> kept ${kept.length}`);
  for (const k of kept) console.log(`      * ${k}`);
  if (kept.includes(c.asked)) console.log('      !! the re-ask survived');

  console.log(`\n  FOLLOW-UP (same words, same day) — note how close it is`);
  for (const q of await composeFollowUps(cfg, c.asked, c.answer, [], 'me')) console.log(`      * ${q}`);
}
