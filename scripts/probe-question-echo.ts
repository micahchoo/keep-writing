// Experiment (2026-09-13): why did the Sitting "Not ready for?" produce no
// follow-ups? Asked "What is one specific area…", answered with three areas,
// bonsai returned the asked question back, verbatim, three times.
//
// Four arms isolate the cause. It is not the list shape of the answer: prose
// echoes too. It is the "Question asked:" line — with it, the model reads its
// terms as unmet and re-issues it, and saying outright that they named three
// does not help. Without it, the same model asks about what was written.
// That result is the second arm in composeFollowUps.
//
// Usage: bun run scripts/probe-question-echo.ts

import { FOLLOW_UP_SYSTEM, extractJson } from '../src/bonsai';

const BASE = 'http://127.0.0.1:8088/v1';
const MODEL = 'bonsai-27b';

const ASKED = 'What is one specific area where you feel the pressure to evolve is most intense right now?';
const LIST = `1. Dating - It used to be easier since I would date only friends and I had lots of friends, making friends is much harder now
2. Going out - I could afford an uber or a rickshaw to travel, but I have to drive now long distances which is extremely stressfull
3. Finding reasons and ways to stay healthy`;
const PROSE = `Dating. It used to be easier since I would date only friends and I had lots of friends, making friends is much harder now. Going out: I could afford an uber or a rickshaw to travel, but I have to drive now long distances which is extremely stressfull. And finding reasons and ways to stay healthy.`;
const ONE_ITEM = `Dating - It used to be easier since I would date only friends and I had lots of friends, making friends is much harder now`;

async function arm(label: string, user: string): Promise<void> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 256,
      messages: [
        { role: 'system', content: FOLLOW_UP_SYSTEM },
        { role: 'user', content: user },
      ],
    }),
  });
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const obj = extractJson(body.choices?.[0]?.message?.content ?? '') as { questions?: string[] } | null;
  const questions = obj?.questions ?? [];
  const echoes = questions.filter((q) => q.trim().toLowerCase() === ASKED.trim().toLowerCase()).length;
  console.log(`\n--- ${label} --- ${echoes}/${questions.length} echo the question asked`);
  for (const q of questions) console.log(`   ${q}`);
}

const up = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(3000) })
  .then((r) => r.ok)
  .catch(() => false);
if (!up) {
  console.log(`bonsai is not up at ${BASE}`);
  process.exit(1);
}

await arm('the question asked + the list', `Question asked: ${ASKED}\n\nAnswer:\n${LIST}`);
await arm('the question asked + the same content as prose', `Question asked: ${ASKED}\n\nAnswer:\n${PROSE}`);
await arm('the question asked + one item of it', `Question asked: ${ASKED}\n\nAnswer:\n${ONE_ITEM}`);
await arm('the question asked + told they named three', `Question asked: ${ASKED}\n\nAnswer (they named three things; ask about one of them):\n${LIST}`);
await arm('no question asked, the list alone', `Answer:\n${LIST}`);
