import { describe, expect, test } from 'bun:test';
import { findCandidates } from '../src/lexical';
import type { Block } from '../src/lexical';
import { blockPool } from '../src/pool';
import { fakeVault } from './fake-vault';

describe('findCandidates keeps the k slots distinct', () => {
  // The corpus keeps every telling of a Piece, so the same paragraph sits in
  // the pool under two refs. Before 2026-09-16 both took a candidate slot and
  // bonsai was shown the same words twice.
  const TWICE = 'In Bidar, there is a community called the Valmiki Samaj who had been doing this for years.';
  const pool: Block[] = [
    { ref: 'Pieces/2020-03-01-collectives#^p-031', text: TWICE },
    { ref: 'Pieces/0000-00-00-collectives-mirror#^p-042', text: TWICE },
    { ref: 'Pieces/2020-03-01-collectives#^p-088', text: 'The Valmiki Samaj archive in Bidar was kept on a phone nobody could unlock.' },
    { ref: 'Pieces/2020-03-01-collectives#^p-090', text: 'Bidar taught me that a community keeps its own record whether or not anyone asks.' },
  ];
  const answer = 'The Valmiki Samaj in Bidar kept a community archive, and Bidar taught me something about record keeping.';

  test('a text that appears twice takes one slot, not two', () => {
    const out = findCandidates(answer, pool, 3);
    expect(out.map((b) => b.text)).toEqual([...new Set(out.map((b) => b.text))]);
    expect(out.length).toBe(3);
  });

  test('the ref kept is the higher-scoring one, and k still fills when it can', () => {
    const out = findCandidates(answer, pool, 4);
    // Four pool entries, two of them the same words: three things to judge.
    expect(out.length).toBe(3);
  });

  test('excludeRef still removes the answer block itself', () => {
    const out = findCandidates(answer, pool, 4, 'Pieces/2020-03-01-collectives#^p-088');
    expect(out.map((b) => b.ref)).not.toContain('Pieces/2020-03-01-collectives#^p-088');
  });
});

describe('blockPool holds the owner words, not the furniture', () => {
  const { app } = fakeVault({
    'Pieces/p.md': [
      '---', 'kind: piece', 'status: published', '---', '',
      'The buffaloes did not look up when the whole procession went past the auto stand. ^p-001', '',
      '{{< figure src="buffalo.jpeg" alt="The procession" >}} ^p-002', '',
      'Fig 4: The auto stand at Koramangala, photographed the following morning ^p-003', '',
      '## Bibliography', '',
      'Ahmed, Sara. Fragile Connections. Durham: Duke University Press. ^p-004',
    ].join('\n'),
    // A short answer is not furniture: a later answer may echo it.
    'Sittings/2026-09-16.md': '## Asked\n\nWho gets to hold memory? ^ans1\n',
    'Bank/q.md': '---\nkind: bank\n---\n- a question? #register/value ^b1\n',
    'Templates/Sitting.md': '## Asked ^t1\n',
  });

  test('furniture leaves; Bank and Templates stay out; the prose stays', async () => {
    const refs = (await blockPool(app, 'Bank')).map((b) => b.ref).sort();
    expect(refs).toEqual(['Pieces/p#^p-001', 'Sittings/2026-09-16#^ans1']);
  });

  test("the draw's word floor does not apply here: a four-word answer is still echoable", async () => {
    const pool = await blockPool(app, 'Bank');
    expect(pool.find((b) => b.ref === 'Sittings/2026-09-16#^ans1')?.text).toBe('Who gets to hold memory?');
  });
});
