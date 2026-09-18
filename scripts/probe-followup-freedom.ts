// Experiment: does a follow-up composed with the whole answer as context, and
// no quote requirement, beat the quote-anchored one? Run against the real
// Sitting of 2026-09-13. Usage: bun run scripts/probe-followup-freedom.ts
import { extractJson, isParrot } from '../src/bonsai';

const BASE = 'http://127.0.0.1:8088/v1';
const MODEL = 'bonsai-2-27b';

const QUESTION = 'How do we bring new ideas to historical dialogues?';
const FIRST_PARAGRAPH =
  'Transition Design - If it is in the service of understanding the historical setting so as to get somewhere else in the future, we should be able to introduce new ideas where the transitions exist';
const FULL_ANSWER = `1. Transition Design - If it is in the service of understanding the historical setting so as to get somewhere else in the future, we should be able to introduce new ideas where the transitions exist
2. Scenario-building - Projecting from the past and seeing hauntological presents, we can see what choices led to the current state and what other states were omitted because of those choices. In order to bring these non-present presents into the present presents, if preferrable, certain ideas that bring them into the present present can be proposed.
Two ways that I primarily see are this
- using or rejecting an echo of the past
- moving the future into something new

There might be a scope to create methods here - #future`;

const QUOTED_SYSTEM = `You are an interviewer helping a person write about their own life and thinking. You read one answer they wrote and compose one follow-up question.

Reply with a JSON object and nothing else. Two shapes are allowed:
{"question": "...", "quote": "..."}
{"abstain": true}

Rules:
- "quote" is a phrase copied from the answer, at least 3 words, character for character: same letters, same case, same punctuation. Do not fix, shorten, or reword it.
- "question" is one question that ends with "?". Ask about the quoted phrase and steer toward the target territory you are given.
- Ask for something you cannot guess from the answer. Do not repeat the answer back as a question.
- Do not refer to the conversation. Never write "you said", "you mentioned", "earlier you".
- If no phrase in the answer deserves a question, reply {"abstain": true}.`;

const FREE_SYSTEM = `You are an autoethnographic interviewer. A person is being interviewed so that their own words become the material for their writing. You are shown the question they were asked and the answer they wrote. Compose the next question.

Reply with a JSON object and nothing else:
{"questions": ["...", "...", "..."]}

Give up to three candidate questions, best first. Each one:
- is a single question, ending with "?", in plain words, under 25 words;
- asks for something only this person can answer and that you cannot guess from the answer;
- reaches for something concrete: a specific time this happened, a real example, a choice they made, a contrast between two things they named, or a consequence they have not stated;
- may use their own terms, but never hands their answer back to them as a question;
- does not refer to the conversation ("you said", "earlier", "your answer").
Do not explain. Do not praise the answer.`;

const STEERED_SYSTEM = FREE_SYSTEM + `

Where to look for the question, in order of preference:
1. A term they coined or use oddly: ask what it means to them, with an example.
2. A thing they named but did not open: ask about it.
3. An abstraction with no scene under it: ask for the moment it comes from.
4. A pole with no contrast: ask what the opposite would be.
5. A cause claimed with no event: ask what happened.
6. A trailing thought, a "might", a tag, an aside: ask what is behind it.`;

async function chat(system: string, user: string, temperature = 0): Promise<string> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature, max_tokens: 400, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? '';
}

function verdicts(q: string, answer: string): string {
  const flags: string[] = [];
  if (!q.trim().endsWith('?')) flags.push('not-interrogative');
  if (isParrot(q, answer)) flags.push('PARROT');
  if (/you said|you mentioned|earlier you|your answer|you wrote/i.test(q)) flags.push('self-ref');
  return flags.length ? flags.join(',') : 'ok';
}

async function arm(label: string, system: string, user: string, answer: string, temperature = 0) {
  const t0 = Date.now();
  const raw = await chat(system, user, temperature);
  const ms = Date.now() - t0;
  const obj = extractJson(raw) as { question?: string; quote?: string; questions?: string[]; abstain?: boolean } | null;
  console.log(`\n=== ${label}  (${ms} ms, temp ${temperature})`);
  if (!obj) { console.log('  unparseable:', raw.slice(0, 200)); return; }
  if (obj.abstain) { console.log('  abstain'); return; }
  if (obj.question) {
    const quoteOk = obj.quote ? answer.includes(obj.quote) : false;
    console.log(`  Q: ${obj.question}\n     [${verdicts(obj.question, answer)}] quote ${quoteOk ? 'exact' : 'NOT exact'}: "${obj.quote}"`);
  }
  for (const q of obj.questions ?? []) console.log(`  Q: ${q}\n     [${verdicts(q, answer)}]`);
}

const ctx = (answer: string) => `Question asked: ${QUESTION}\n\nAnswer:\n${answer}`;

await arm('A  quoted prompt, first paragraph only (what shipped)', QUOTED_SYSTEM, `Target: me\n\nAnswer:\n${FIRST_PARAGRAPH}`, FIRST_PARAGRAPH);
await arm('B  quoted prompt, full answer', QUOTED_SYSTEM, `Target: me\n\nAnswer:\n${FULL_ANSWER}`, FULL_ANSWER);
await arm('C  free prompt, question + full answer', FREE_SYSTEM, ctx(FULL_ANSWER), FULL_ANSWER);
await arm('D  steered prompt, question + full answer', STEERED_SYSTEM, ctx(FULL_ANSWER), FULL_ANSWER);
await arm('C2 free prompt, temp 0.7', FREE_SYSTEM, ctx(FULL_ANSWER), FULL_ANSWER, 0.7);
await arm('D2 steered prompt, temp 0.7', STEERED_SYSTEM, ctx(FULL_ANSWER), FULL_ANSWER, 0.7);
