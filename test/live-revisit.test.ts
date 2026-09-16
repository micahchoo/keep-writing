// Live: compose Revisit questions for real corpus paragraphs. KW_LIVE=1 to run.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { composeRevisit } from '../src/bonsai';
import { bodyOf } from '../src/lens';

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

const fetcher = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
  const r = await fetch(url, init);
  return { status: r.status, text: await r.text() };
};
const cfg = { baseUrl: BASE, model: 'bonsai-27b', fetcher };
const lens = (name: string) => {
  try {
    return bodyOf(readFileSync(`${VAULT}/Lenses/${name}.md`, 'utf8'));
  } catch {
    return '';
  }
};
const show = (label: string, p: string, qs: { question: string; dueDays?: number }[]) =>
  console.log(`\n[${label}]\n` + p + '\n' + qs.map((q) => '  Q: ' + q.question + (q.dueDays ? ` (due +${q.dueDays}d)` : '')).join('\n'));

describe.skipIf(!live)('Revisit on real corpus paragraphs', () => {
  test('a poem stanza, 2021', async () => {
    const p = paragraph('Pieces/2021-01-01-koramangala.md', 'p-002');
    const qs = await composeRevisit(cfg, p, 'in 2021, as a poem about their street in Koramangala');
    show('poem', p, qs);
    expect(qs.length).toBeGreaterThan(0);
  }, 60_000);
  test('an essay paragraph, published', async () => {
    const p = paragraph('Pieces/2021-08-01-jingle-tales.md', 'p-002');
    const qs = await composeRevisit(cfg, p, 'in 2021, for Critical Code Recipes', lens('craft'));
    show('essay, craft lens', p, qs);
    expect(qs.length).toBeGreaterThan(0);
  }, 60_000);
  test('a stalled draft paragraph', async () => {
    const lines = readFileSync(`${VAULT}/Pieces/2020-02-01-care-in-collectives.md`, 'utf8');
    const id = (lines.match(/\^(p-00[3-6])\s*$/m) ?? [])[1] ?? 'p-002';
    const p = paragraph('Pieces/2020-02-01-care-in-collectives.md', id);
    const qs = await composeRevisit(cfg, p, 'in 2020, in a draft they set down');
    show('draft', p, qs);
    expect(qs.length).toBeGreaterThan(0);
  }, 60_000);
});
