import { describe, expect, test } from 'bun:test';
import { drawMany, fillJars } from '../src/bank';
import type { DrawContext } from '../src/bank';
import { fakeVault } from './fake-vault';

// The draw reads the vault when the owner asks, and at no other time. There
// was an index until 2026-09-24 that rebuilt the jars 250 ms after every save
// of every note, so that a draw could be answered from memory. Obsidian's
// metadata cache already knows every block id and every `answers` link; a
// draw lists those, chooses, and reads only the notes it chose.

const prose = (n: number) => `The afternoon I walked to the river for the ${n}th time, and the water had nothing to say.`;

function ctx(app: DrawContext['app'], over: Partial<DrawContext> = {}): DrawContext {
  return { app, bankFolder: 'Bank', sittingsFolder: 'Sittings', writingFolders: ['Pieces'], skipped: new Set(), ...over };
}

/** Hands back these numbers in order, then 0 forever. */
const sequence = (xs: number[]) => { let i = 0; return () => xs[i++] ?? 0; };

describe('a draw reads only what it chose', () => {
  test('forty Pieces in the jar, three drawn, three read', async () => {
    const notes: Record<string, string> = { 'Bank/q.md': '---\nkind: bank\n---\n- a question? #register/value ^b1\n' };
    for (let i = 0; i < 40; i++) notes[`Pieces/${i}.md`] = `${prose(i)} ^p${i}\n`;
    const reads: string[] = [];
    const v = fakeVault(notes, { beforeRead: (path) => { reads.push(path); } });
    const { drawn, jars } = await drawMany(ctx(v.app, { bankShare: 0 }), null, 3);
    expect(jars.paragraphs).toBe(40);
    const chosen = drawn.map((d) => d.source.kind === 'paragraph' ? d.source.file.path : '');
    expect(reads.filter((p) => p.startsWith('Pieces/')).sort()).toEqual(chosen.sort());
  });
});

describe('Furniture the draw lands on', () => {
  const v = fakeVault({
    'Bank/q.md': '---\nkind: bank\n---\n- a question? #register/value ^b1\n',
    'Pieces/fig.md': 'Fig 4: The auto stand at Koramangala, photographed the next morning ^f\n',
    'Pieces/real.md': `${prose(1)} ^r\n`,
  });

  // A re-toss would hand the Bank more than its share whenever the paragraph
  // jar holds Furniture: 27% of the blocks in this vault's Pieces, measured
  // 2026-09-15, would move the Bank from 70% to 76% of the draws.
  test('is put back, and the paragraph jar is asked again rather than the coin', async () => {
    // 0.9: the paragraph jar. 0.0: its first block, the caption. Then 0.0
    // again — which a re-toss would read as the Bank.
    const { drawn } = await drawMany(ctx(v.app, { bankShare: 0.5, random: sequence([0.9, 0.0, 0.0]) }), null, 1);
    expect(drawn.map((d) => d.source.key)).toEqual(['Pieces/real.md#^r']);
  });

  test('when nothing but Furniture is left, the Bank answers', async () => {
    const only = fakeVault({
      'Bank/q.md': '---\nkind: bank\n---\n- a question? #register/value ^b1\n',
      'Pieces/fig.md': 'Fig 4: The auto stand at Koramangala, photographed the next morning ^f\n',
    });
    const { drawn } = await drawMany(ctx(only.app, { bankShare: 0.5, random: sequence([0.9, 0.0]) }), null, 1);
    expect(drawn.map((d) => d.source.key)).toEqual(['Bank/q.md#^b1']);
  });
});

describe('answered-ness is read at draw time', () => {
  test('an answer written between two draws retires its source, with no event in between', async () => {
    const v = fakeVault({
      'Pieces/a.md': `${prose(1)} ^a\n`,
      'Sittings/today.md': '## Asked\n\nMy answer. ^ans\n',
    });
    const before = await fillJars(ctx(v.app), null);
    expect(before.paragraphs.map((p) => p.key)).toEqual(['Pieces/a.md#^a']);
    await v.app.fileManager.processFrontMatter(v.file('Sittings/today.md'), (fm) => { fm['answers'] = ['[[Pieces/a#^a]]']; });
    expect((await fillJars(ctx(v.app), null)).paragraphs).toEqual([]);
  });
});

describe('bank proportions in the vault', () => {
  test('disabled banks are absent from the counts and their notes are not read', async () => {
    const reads: string[] = [];
    const v = fakeVault({
      'Questions/ordinary-life.md': '---\nkind: bank\n---\n- what was lunch? #register/episode ^o1\n',
      'Questions/local/custom.md': '---\nkind: bank\n---\n- what was on your mind? #register/value ^c1\n',
    }, { beforeRead: (path) => { reads.push(path); } });
    const { drawn, jars } = await drawMany(ctx(v.app, {
      bankFolder: 'Questions', bankWeights: { 'ordinary-life.md': 0, 'local/custom.md': 5 }, random: sequence([0]),
    }), null, 3);
    expect(jars.questions).toBe(1);
    expect(drawn.map((d) => d.source.key)).toEqual(['Questions/local/custom.md#^c1']);
    expect(reads).toEqual(['Questions/local/custom.md']);
  });

  test('after a bank runs out, draws continue through the remaining banks without repeats', async () => {
    const v = fakeVault({
      'Bank/ordinary-life.md': '---\nkind: bank\n---\n- what was lunch? #register/episode ^o1\n',
      'Bank/invention.md': '---\nkind: bank\n---\n- what might be next? #register/possibility ^i1\n- what could change? #register/possibility ^i2\n',
      'Bank/learning.md': '---\nkind: bank\n---\n- what did you learn? #register/knowledge ^l1\n',
      'Sittings/answered.md': '---\nanswers: ["[[Bank/learning#^l1]]"]\n---\n',
    });
    const { drawn, jars } = await drawMany(ctx(v.app, { random: sequence([0]) }), null, 5);
    expect(jars.questions).toBe(3);
    expect(drawn.map((d) => d.source.key)).toEqual(['Bank/ordinary-life.md#^o1', 'Bank/invention.md#^i1', 'Bank/invention.md#^i2']);
  });

  test('paragraph exhaustion never re-enables a disabled bank', async () => {
    const v = fakeVault({
      'Bank/q.md': '---\nkind: bank\n---\n- a question? #register/value ^b1\n',
      'Pieces/fig.md': 'Fig 4: The auto stand at Koramangala, photographed the next morning ^f\n',
      'Pieces/real.md': `${prose(1)} ^r\n`,
    });
    const { drawn } = await drawMany(ctx(v.app, { bankWeights: { 'q.md': 0 }, random: sequence([0]) }), null, 3);
    expect(drawn.map((d) => d.source.key)).toEqual(['Pieces/real.md#^r']);
  });
});
