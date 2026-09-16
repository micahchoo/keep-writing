// Live: a Revisit through the craft Lens on a real gathered paragraph. KW_LIVE=1.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { composeRevisit } from '../src/bonsai';

const BASE = 'http://127.0.0.1:8088/v1';
const up = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
const live = process.env['KW_LIVE'] === '1' && up;
const VAULT = `${import.meta.dir}/../../../..`;

function paragraph(path: string, id: string): string {
  const lines = readFileSync(`${VAULT}/${path}`, 'utf8').split('\n');
  const end = lines.findIndex((l) => l.trimEnd().endsWith(`^${id}`));
  let start = end;
  while (start > 0 && lines[start - 1]!.trim() !== '') start--;
  return lines.slice(start, end + 1).join('\n').replace(/\s+\^[A-Za-z0-9-]+\s*$/, '');
}
const lens = (name: string) => readFileSync(`${VAULT}/Lenses/${name}.md`, 'utf8').replace(/^---[\s\S]*?---\s*/, '').trim();
const fetcher = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
  const r = await fetch(url, init);
  return { status: r.status, text: await r.text() };
};
const cfg = { baseUrl: BASE, model: 'bonsai-27b', fetcher };

describe.skipIf(!live)('Revisit through a Lens', () => {
  test('craft lens on Jingle Tales (Teaching and Learning)', async () => {
    const p = paragraph('Pieces/2021-08-01-jingle-tales.md', 'p-002');
    const plain = await composeRevisit(cfg, p, 'in 2021, for Critical Code Recipes', []);
    const lensed = await composeRevisit(cfg, p, 'in 2021, for Critical Code Recipes', [], lens('craft'));
    console.log('\n[no lens]\n' + plain.map((c) => '  Q: ' + c.question).join('\n'));
    console.log('[craft lens]\n' + lensed.map((c) => '  Q: ' + c.question).join('\n'));
    expect(lensed.length).toBeGreaterThan(0);
  }, 90_000);
  test('learning lens on a paragraph about wanting to learn', async () => {
    const p = 'I want to understand Rust lifetimes properly. I can get code to compile by adding annotations until the errors stop, but I could not explain to anyone why a particular lifetime is required, and I suspect the compiler is telling me something about ownership that I keep ignoring.';
    const out = await composeRevisit(cfg, p, 'in what they wrote about wanting to learn Rust lifetimes', [], lens('learning'));
    console.log('[learning lens]\n' + out.map((c) => `  Q: ${c.question}${c.dueDays ? `  (due +${c.dueDays}d)` : ''}`).join('\n'));
    expect(out.length).toBeGreaterThan(0);
  }, 90_000);
});
