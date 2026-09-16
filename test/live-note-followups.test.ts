// Live diagnosis: run the real follow-up path over every Ask of one real
// Sitting and print what the model returned and what the checks did with it.
//   KW_LIVE=1 KW_NOTE="Sittings/Not ready for?.md" bun test test/live-note-followups.test.ts
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { answerText, parseAsks } from '../src/asks';
import { composeFollowUps } from '../src/bonsai';
import type { CallLog } from '../src/bonsai';

const BASE = 'http://127.0.0.1:8088/v1';
const VAULT = `${import.meta.dir}/../../../..`;
const NOTE = process.env['KW_NOTE'] ?? 'Sittings/2026-09-13.md';
const up = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
const live = process.env['KW_LIVE'] === '1' && up;

const fetcher = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
  const r = await fetch(url, init);
  return { status: r.status, text: await r.text() };
};

describe.skipIf(!live)(`follow-ups on ${NOTE}`, () => {
  test('every Ask, its answer, and what the model made of it', async () => {
    const md = readFileSync(`${VAULT}/${NOTE}`, 'utf8');
    const asks = parseAsks(md);
    console.log(`\n${NOTE}: ${asks.length} Asks`);
    for (const [i, ask] of asks.entries()) {
      const answer = answerText(md, ask);
      console.log(`\n--- Ask ${i + 1} ------------------------------------------`);
      console.log(`Q: ${ask.question}`);
      console.log(`from: ${ask.sourceRef || '(none)'}`);
      console.log(`answer lines ${ask.answer.start}..${ask.answer.end}, ${answer.length} chars`);
      console.log(`answer: ${JSON.stringify(answer.slice(0, 400))}`);
      if (!answer) {
        console.log('  -> no answer text: afterAnswer returns before the model is called');
        continue;
      }
      const onLog = (e: CallLog) =>
        console.log(`    [try ${e.attempt}] ${e.outcome} in ${e.ms}ms${e.reason ? `\n      reason: ${e.reason}` : ''}`);
      const qs = await composeFollowUps({ baseUrl: BASE, model: 'bonsai-27b', fetcher, onLog }, ask.question, answer, 'me');
      console.log(`  -> ${qs.length} kept`);
      for (const q of qs) console.log(`     + ${q}`);
    }
    expect(asks.length).toBeGreaterThan(0);
  }, 180_000);
});
