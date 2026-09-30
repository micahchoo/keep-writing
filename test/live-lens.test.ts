// Live: a Revisit through the craft Lens on a real gathered paragraph. KW_LIVE=1.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { composeRevisit } from '../src/bonsai';
import { CRAFT_LENS, REVISIT_WHERE, STANCE } from '../src/lens';

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
const fetcher = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
  const r = await fetch(url, init);
  return { status: r.status, text: await r.text() };
};
const cfg = { baseUrl: BASE, model: 'qwen3.8-27b', fetcher };

describe.skipIf(!live)('Revisit through a Lens', () => {
  test('craft lens on Jingle Tales (Teaching and Learning)', async () => {
    const p = paragraph('Pieces/2021-08-01-jingle-tales.md', 'p-002');
    const plain = await composeRevisit(cfg, p, 'in 2021, for Critical Code Recipes', [], { stance: STANCE, lens: REVISIT_WHERE });
    const lensed = await composeRevisit(cfg, p, 'in 2021, for Critical Code Recipes', [], { stance: STANCE, lens: CRAFT_LENS });
    console.log('\n[no lens]\n' + plain.map((c) => '  Q: ' + c.question).join('\n'));
    console.log('[craft lens]\n' + lensed.map((c) => '  Q: ' + c.question).join('\n'));
    expect(lensed.length).toBeGreaterThan(0);
  }, 90_000);
});
