// Probe: run both bonsai jobs and the lexical finder against the live server.
// Usage: bun run scripts/probe-bonsai.ts [runs]

import { composeFollowUps, proposeRelation, isParrot, type BonsaiConfig, type CallLog, type Fetcher } from '../src/bonsai';
import { findCandidates, type Block } from '../src/lexical';

const BASE_URL = 'http://127.0.0.1:8088/v1';
const MODEL = 'bonsai-27b';
const PREFLIGHT_MS = 30_000;

const ANSWER =
  'I started sharpening knives last winter because the chef knife had gone so dull it bruised tomatoes instead of cutting them. ' +
  'The first month was a slow humiliation. I raised the angle too high, I pressed too hard, and I kept feeling for a burr that never came. ' +
  'What finally clicked was the sound: a sharp edge on a whetstone hisses, a dull one scrapes. ' +
  'Now I sharpen every Sunday. It is the only chore where I feel like I am negotiating with the steel.';

const POOL: Block[] = [
  { ref: 'Sittings/2026-07-02#^a1b2c3', text: 'I bought a 1000/6000 whetstone in June and ruined the chef knife edge the first evening by holding the angle far too steep. I put it away for weeks.' },
  { ref: 'Sittings/2026-07-19#^d4e5f6', text: 'The kitchen is where I am most patient. Sharpening the knife on a Sunday feels like a small ceremony before the week starts.' },
  { ref: 'Sittings/2026-06-11#^g7h8i9', text: 'Blender still fights me on weight painting. Every rig I make has one shoulder that folds like paper.' },
  { ref: 'Sittings/2026-08-03#^j0k1l2', text: 'My grandmother kept a garden that fed six people. I remember the smell of tomato leaves on her hands more than her face.' },
  { ref: 'Sittings/2026-08-21#^m3n4o5', text: 'I switched the Tauri build to a nightly toolchain to get the new window API and regretted it the same afternoon.' },
  { ref: 'Sittings/2026-05-30#^p6q7r8', text: 'Running before sunrise is the only time the city is quiet enough for me to hear my own breathing.' },
];

const TARGET = 'me';

const fetcher: Fetcher = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
  return { status: res.status, text: await res.text() };
};

async function preflight(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(PREFLIGHT_MS) });
    console.log(`preflight GET /models -> ${res.status}`);
    return res.ok;
  } catch (err) {
    console.log(`preflight failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function logger(sink: CallLog[]): (e: CallLog) => void {
  return (e) => {
    sink.push(e);
    const reason = e.reason ? `  reason: ${e.reason}` : '';
    console.log(`  [${e.job}] attempt ${e.attempt}  ${e.ms} ms  ${e.outcome}${reason}`);
  };
}

async function runOnce(run: number): Promise<void> {
  console.log(`\n===== run ${run} =====`);

  console.log('\n-- findCandidates (k=5) --');
  const candidates = findCandidates(ANSWER, POOL, 5);
  if (candidates.length === 0) console.log('  (none)');
  candidates.forEach((c, i) => console.log(`  ${i + 1}. ${c.ref}  "${c.text.slice(0, 60)}..."`));

  console.log('\n-- composeFollowUps --');
  const fuLog: CallLog[] = [];
  const cfg: BonsaiConfig = { baseUrl: BASE_URL, model: MODEL, fetcher, timeoutMs: 60_000, onLog: logger(fuLog) };
  const fus = await composeFollowUps(cfg, 'What is a chore you have come to like?', ANSWER, [], TARGET);
  for (const q of fus) console.log(`  Q: ${q}  [parrot: ${isParrot(q, ANSWER)}]`);
  if (fus.length === 0) console.log('  (none)');

  console.log('\n-- proposeRelation --');
  const relLog: CallLog[] = [];
  const cfg2: BonsaiConfig = { ...cfg, onLog: logger(relLog) };
  const prop = await proposeRelation(cfg2, ANSWER, candidates.length > 0 ? candidates : POOL.slice(0, 5));
  console.log(`  result: ${JSON.stringify(prop)}`);
  if (prop) {
    const block = POOL.find((b) => b.ref === prop.ref);
    console.log(`  check ref known: ${block !== undefined}`);
    console.log(`  check substring of candidate: ${block ? block.text.includes(prop.quote) : false}`);
  }
}

const runs = Number(process.argv[2] ?? '1');
if (!(await preflight())) {
  console.log(`server at ${BASE_URL} did not answer within ${PREFLIGHT_MS / 1000} s; stopping.`);
  process.exit(1);
}
for (let i = 1; i <= runs; i++) await runOnce(i);
