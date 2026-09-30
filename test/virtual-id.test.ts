import { describe, expect, test } from 'bun:test';
import { drawMany } from '../src/bank';
import { emptyDrawLine } from '../src/interview';
import type { DrawContext } from '../src/bank';
import { addressSource, ensureSourceBlockId } from '../src/blocks';
import { appendAsk, parseAsks } from '../src/asks';
import { paragraphAt, paragraphJar, readBlock } from '../src/paragraphs';
import { virtualId } from '../src/refs';
import { fakeVault } from './fake-vault';

// Most owners have never written a block id, and most do not want one written
// into their prose. A paragraph without an id is addressed by a VIRTUAL id,
// `^kw-` and a hash of its words, which is written nowhere in the note. Until
// 2026-09-29 the jar held only paragraphs that already carried an id, so on a
// fresh install — measured on a Notion export of 9,408 notes — the paragraph
// jar was empty and the draw said so as if everything had been answered.
//
// Verified live in Obsidian 2026-09-29: `[[note#^kw-3f9a1c]]` with no such id
// in the note is a RESOLVED link to the note, and shows in its backlinks.

const A = 'The river was higher that year than anyone in the village remembered, and nobody said so.';
const B = 'My grandmother kept the ration cards in a biscuit tin long after the shop had closed.';

function ctx(app: DrawContext['app'], over: Partial<DrawContext> = {}): DrawContext {
  return { app, bankFolder: 'Bank', sittingsFolder: 'Sittings', writingFolders: ['Notes'], skipped: new Set(), bankShare: 0, ...over };
}

const jarOf = async (app: DrawContext['app']) => {
  const read = await Promise.all(paragraphJar(app, ['Notes']).map((b) => readBlock(app, 'Sittings', b)));
  return read.filter((p) => p !== null);
};

describe('virtualId', () => {
  test('is a function of the words, not of where they sit', () => {
    expect(virtualId(A)).toMatch(/^kw-[a-z0-9]{7}$/);
    expect(virtualId(A)).toBe(virtualId(`  ${A.replace(' that ', '\nthat  ')} `));
    expect(virtualId(A)).not.toBe(virtualId(B));
  });
});

describe('a paragraph with no id', () => {
  const note = `# Day two\n\n${A}\n\n- a list item that is not a paragraph\n\n${B} ^b1\n`;

  test('enters the jar under its virtual id, beside the anchored ones', async () => {
    const v = fakeVault({ 'Notes/river.md': note });
    const jar = await jarOf(v.app);
    expect(jar.map((p) => p.key).sort()).toEqual([`Notes/river.md#^${virtualId(A)}`, 'Notes/river.md#^b1'].sort());
    const a = jar.find((p) => p.text === A);
    expect(a?.ref).toEqual({ path: 'Notes/river', blockId: virtualId(A) });
  });

  test('keeps its key when lines are added above it', async () => {
    const v = fakeVault({ 'Notes/river.md': `Something new written at the top of the note, a whole sentence long.\n\n${note}` });
    expect((await jarOf(v.app)).map((p) => p.key)).toContain(`Notes/river.md#^${virtualId(A)}`);
  });

  test('is still strained for Furniture', async () => {
    const v = fakeVault({ 'Notes/fig.md': 'Fig 4: The auto stand at Koramangala, photographed the next morning\n' });
    expect(await jarOf(v.app)).toEqual([]);
  });

  test('is not drawn once an answer links its virtual id', async () => {
    const v = fakeVault({
      'Notes/river.md': note,
      'Sittings/2026-09-20.md': `---\nanswers:\n- "[[Notes/river#^${virtualId(A)}]]"\n---\n\nIt was the monsoon of the flood. ^ans1\n`,
    });
    const { drawn } = await drawMany(ctx(v.app), null, 5);
    expect(drawn.map((d) => d.source.key)).toEqual(['Notes/river.md#^b1']);
  });

  test('accepting it writes nothing to the note', async () => {
    const v = fakeVault({ 'Notes/river.md': note });
    const file = v.file('Notes/river.md');
    const ref = { path: 'Notes/river', blockId: virtualId(A) };
    expect(await ensureSourceBlockId(v.app, { file, ref, text: A })).toEqual(ref);
    expect(v.writes).toHaveLength(0);
  });

  test('accepting it refuses once the words have changed', async () => {
    const v = fakeVault({ 'Notes/river.md': note.replace('higher', 'lower') });
    const file = v.file('Notes/river.md');
    await expect(ensureSourceBlockId(v.app, { file, ref: { path: 'Notes/river', blockId: virtualId(A) }, text: A })).rejects.toThrow();
  });

  test('a virtual ref resolves back to its paragraph', async () => {
    const v = fakeVault({ 'Notes/river.md': note });
    const p = await paragraphAt(v.app, { path: 'Notes/river', blockId: virtualId(A) }, 'Sittings');
    expect(p?.text).toBe(A);
  });
});

describe('pasting a source the note cannot transclude', () => {
  test('quotes every line inside the callout, and the parser still reads one Ask', () => {
    const { text } = appendAsk('## Asked\n', 'what was it like?', `Notes/river#^${virtualId(A)}`, { paste: `${A}\nfrom [[x]] and due: 2020-01-01` });
    expect(text).toContain(`> > ${A}\n> > from [[x]] and due: 2020-01-01\n`);
    const [ask] = parseAsks(text);
    expect(ask?.sourceRef).toBe(`Notes/river#^${virtualId(A)}`);
    expect(ask?.due).toBeUndefined();
  });
});

describe('a selection with no id', () => {
  const note = `Intro paragraph that is long enough to be read as prose by anyone.\n\n- ${B}\n- a second item\n`;

  test('in a list item is addressed without a write, and resolves back', async () => {
    const v = fakeVault({ 'Notes/tin.md': note });
    const file = v.file('Notes/tin.md');
    const got = await addressSource(v.app, { file, ref: { path: 'Notes/tin' }, text: 'ration cards', selectionSnapshot: { selected: 'ration cards' } });
    expect(got).toEqual({ ref: { path: 'Notes/tin', blockId: virtualId(B) }, text: B });
    expect(v.writes).toHaveLength(0);
    expect((await paragraphAt(v.app, got.ref, 'Sittings'))?.text).toBe(B);
  });

  test('in a block that carries an id is addressed by that id', async () => {
    const v = fakeVault({ 'Notes/river.md': `${A} ^own\n` });
    const file = v.file('Notes/river.md');
    const got = await addressSource(v.app, { file, ref: { path: 'Notes/river' }, text: 'higher', selectionSnapshot: { selected: 'higher' } });
    expect(got.ref).toEqual({ path: 'Notes/river', blockId: 'own' });
    expect(v.writes).toHaveLength(0);
  });
});

// The notice said "Every source here is answered or already asked" when the
// jars had never held anything — on the Notion export, 9,408 notes and not one
// id. An empty vault and a spent one are different facts and say different things.
describe('an empty draw says why', () => {
  test('nothing was ever there: it names where it looked', () => {
    expect(emptyDrawLine({ questions: 0, paragraphs: 0 }, null, ['Notion', 'Sittings'], 'Bank')).toBe(
      'Nothing to draw from: no paragraphs in Notion or Sittings, and no questions in Bank. Name a writing folder or install a bank in settings.',
    );
    expect(emptyDrawLine({ questions: 0, paragraphs: 0 }, null, [], 'Bank')).toBe(
      'Nothing to draw from: no writing folder is named, and no questions in Bank. Name a writing folder or install a bank in settings.',
    );
  });
  test('everything there is spent', () => {
    expect(emptyDrawLine({ questions: 0, paragraphs: 12 }, null, ['Notion'], 'Bank')).toBe(
      'Nothing left to draw. Every source here is answered, already asked, or not a paragraph.',
    );
  });
  test('a Target with nothing in it names the Target', () => {
    expect(emptyDrawLine({ questions: 0, paragraphs: 0 }, 'Rivers', ['Notion'], 'Bank')).toBe('Nothing to draw in Rivers: it has no paragraph left to ask about.');
  });
});
