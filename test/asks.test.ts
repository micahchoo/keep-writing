import { describe, expect, test } from 'bun:test';
import { appendAsk, markAnswered, parseAsks, questionsAbout } from '../src/asks';
import type { Ask } from '../src/asks';
import { fakeVault } from './fake-vault';

const sitting = `---
about: "[[me]]"
answers:
  - "[[Bank/questions for meaningful introductions#^b17850831]]"
---

## Asked

> [!ask] what do you get complimented on the most?
> from [[Bank/questions for meaningful introductions#^b17850831]]

My patience, mostly. People say I wait well. ^k3m9x1

And a second paragraph.

> [!ask] what's something you've put on hold?
> from [[Bank/questions for meaningful introductions#^b18645301]]
> due: 2026-09-20

`;

describe('parseAsks', () => {
  const answered = new Set(['Bank/questions for meaningful introductions#^b17850831']);
  const asks = parseAsks(sitting, (src) => answered.has(src));

  test('finds both asks with question, source and due', () => {
    expect(asks).toHaveLength(2);
    expect(asks[0]!.question).toBe('what do you get complimented on the most?');
    expect(asks[0]!.sourceRef).toBe('Bank/questions for meaningful introductions#^b17850831');
    expect(asks[0]!.due).toBeUndefined();
    expect(asks[1]!.due).toBe('2026-09-20');
  });

  test('answer range runs from callout end to the next ask', () => {
    const a = asks[0]!;
    expect(a.callout).toEqual({ start: 8, end: 9 });
    expect(a.answer).toEqual({ start: 10, end: 15 });
    expect(a.firstParagraph).toEqual({ start: 11, end: 11 });
  });

  test('an ask with only blank lines after it has no answer', () => {
    expect(asks[1]!.firstParagraph).toBeNull();
    expect(asks[1]!.answer.end).toBe(20);
  });

  test('answered-ness comes from the callback over the source ref', () => {
    expect(asks[0]!.answered).toBe(true);
    expect(asks[1]!.answered).toBe(false);
  });

  test('a heading ends the answer', () => {
    const md = `> [!ask] q\n> from [[Bank/x#^a1]]\n\nanswer\n\n## Notes\nnot an answer\n`;
    const [a] = parseAsks(md);
    expect(a!.answer).toEqual({ start: 2, end: 5 });
  });
});

describe('appendAsk', () => {
  test('appends after the last ask in ## Asked, one blank line, cursor line', () => {
    const { text, cursorLine } = appendAsk(sitting, 'who have you taken for granted?', 'Bank/q#^b18666571');
    const lines = text.split('\n');
    expect(lines[cursorLine]).toBe('');
    expect(lines[cursorLine - 1]).toBe('');
    expect(lines[cursorLine - 2]).toBe('> from [[Bank/q#^b18666571]]');
    expect(lines[cursorLine - 3]).toBe('> [!ask] who have you taken for granted?');
    expect(lines[cursorLine - 4]).toBe('');
    expect(cursorLine).toBe(lines.length - 1);
  });

  test('creates the heading when missing and writes due', () => {
    const { text } = appendAsk('---\nabout: "[[me]]"\n---\n', 'q?', 'Bank/learning#^l1', { due: '2026-09-20' });
    expect(text).toBe('---\nabout: "[[me]]"\n---\n\n## Asked\n\n> [!ask] q?\n> from [[Bank/learning#^l1]]\n> due: 2026-09-20\n\n');
  });

  test('keeps a following section below the new ask', () => {
    const md = '## Asked\n\n> [!ask] a\n> from [[B#^1]]\n\nans\n\n## Later\ntext\n';
    const { text, cursorLine } = appendAsk(md, 'b', 'B#^2');
    const lines = text.split('\n');
    expect(lines[cursorLine + 1]).toBe('## Later');
    expect(lines.slice(0, 6).join('\n')).toBe(md.split('\n').slice(0, 6).join('\n'));
  });
});

describe('from-lines written before the two jars', () => {
  test('an old `about [[...]]` clause after the link is ignored; the source is still read', () => {
    const md = '## Asked\n\n> [!ask] what in [[Blender]] can you almost do?\n> from [[Bank/craft#^c-034]] about [[Blender]]\n\nRigging.\n';
    const [a] = parseAsks(md, (src) => src === 'Bank/craft#^c-034');
    expect(a?.sourceRef).toBe('Bank/craft#^c-034');
    expect(a?.answered).toBe(true);
  });
});

describe('revisit asks', () => {
  const ref = 'Pieces/2021-feeling-through-the-cities-koramangala#^p-004';

  test('appendAsk with embed puts the paragraph under the from-line, before due', () => {
    const { text, cursorLine } = appendAsk('## Asked\n', 'what did the buffaloes see that you left out?', ref, {
      embed: true,
      due: '2026-09-20',
    });
    expect(text).toBe(
      '## Asked\n\n> [!ask] what did the buffaloes see that you left out?\n' +
        `> from [[${ref}]]\n> ![[${ref}]]\n> due: 2026-09-20\n\n`,
    );
    expect(text.split('\n')[cursorLine]).toBe('');
  });

  test('parseAsks reads the embedded ask back: source from the from-line, the embed swallowed into the callout', () => {
    const { text, cursorLine } = appendAsk('## Asked\n', 'what did the buffaloes see that you left out?', ref, { embed: true });
    const lines = text.split('\n');
    lines[cursorLine] = 'They saw the trucks first. I only heard them.';
    const [ask] = parseAsks(lines.join('\n'), (src) => src === ref);
    expect(ask?.sourceRef).toBe(ref);
    expect(ask?.due).toBeUndefined();
    expect(ask?.callout).toEqual({ start: 2, end: 4 });
    expect(ask?.firstParagraph).toEqual({ start: cursorLine, end: cursorLine });
    expect(ask?.answered).toBe(true);
  });

  test('an embed line before the from-line is not taken for the source', () => {
    const md = `> [!ask] q?\n> ![[${ref}]]\n> from [[${ref}]]\n`;
    expect(parseAsks(md)[0]?.sourceRef).toBe(ref);
  });
});

// The shape of a real Sitting: a Bank question, the owner's answer, then a
// Follow-up composed from that answer, then its answer. Both Asks are "about"
// the first answer block, by different routes.
describe('questionsAbout', () => {
  const SITTING = [
    '## Asked',
    '',
    '> [!ask] What makes repetition of our conditions hopeless or energizing?',
    '> from [[Bank/cinema#^b41440102-2]]',
    '',
    'When things occur, over and over, we cannot stop the train. ^hrit0q',
    '',
    '> [!ask] What is one condition you repeat that you wish you could stop doing?',
    '> from [[Sittings/2026-09-14#^hrit0q]]',
    '',
    'I think suffering from bipolar enhanced my connection with my bed. ^og5etj',
  ].join('\n');
  const asks = parseAsks(SITTING);
  const isSource = (ref: string) => ref === 'Sittings/2026-09-14#^hrit0q';

  test('the block carries the question it answers AND the one composed from it', () => {
    expect(questionsAbout(asks, 5, isSource)).toEqual([
      'What makes repetition of our conditions hopeless or energizing?',
      'What is one condition you repeat that you wish you could stop doing?',
    ]);
  });

  test('a later block carries only the question it answers', () => {
    expect(questionsAbout(asks, 10, () => false)).toEqual([
      'What is one condition you repeat that you wish you could stop doing?',
    ]);
  });

  test('a line outside every answer, and a Sitting with no Asks, carry nothing', () => {
    expect(questionsAbout(asks, 0, () => false)).toEqual([]);
    expect(questionsAbout(parseAsks('just prose, no asks'), 0, () => false)).toEqual([]);
  });

  test('a malformed Ask with no source is never matched by ref', () => {
    const noSource = parseAsks('> [!ask] a question with no from-line\n\nan answer');
    expect(questionsAbout(noSource, 99, () => true)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// "Every answer is linked at birth" (CONTEXT.md, Invariants). Untestable
// before 2026-09-16: the fake vault had no frontmatter write.

const MARKABLE = `---
about: "[[Blender]]"
---

## Asked

> [!ask] what did you make?
> from [[Bank/craft#^b1]]

I rigged a walk cycle and it fell over twice.

> [!ask] where should we pick up?
> from [[Bank/closing#^bm1]]

With the hips. That is where it broke.

> [!ask] what did we not touch today?
> from [[Bank/closing#^dr1]]

`;

const markVault = () =>
  fakeVault({
    'Sittings/2026-09-15.md': MARKABLE,
    'Domains/Blender.md': '---\ngathers: [blender]\n---\n\nI rig badly. ^r1\n',
    'me.md': '---\ntitle: me\n---\n\nThe self.\n',
    'Bank/craft.md': '---\nkind: bank\n---\n\n- what did you make? #register/episode ^b1\n',
    'Bank/closing.md':
      '---\nkind: bank\n---\n\n- where should we pick up? #register/intention #role/bookmark ^bm1\n- what did we not touch today? #register/general-event #role/door ^dr1\n',
  });

describe('marking an answer done', () => {
  const opts = { bankFolder: 'Bank' };
  const asksIn = (v: ReturnType<typeof markVault>) => parseAsks(v.text('Sittings/2026-09-15.md'));
  /** The answer block's ref, failing loudly if marking refused. */
  const mark = async (v: ReturnType<typeof markVault>, ask: Ask) => {
    const marked = await markAnswered(v.app, v.file('Sittings/2026-09-15.md'), ask, opts);
    if (marked.kind !== 'ok') throw new Error(`refused: ${marked.reason}`);
    return marked.ref;
  };

  test('the answer gets a block id and both ends of `answers` are written', async () => {
    const v = markVault();
    const ref = await mark(v, asksIn(v)[0] as Ask);
    expect(ref.path).toBe('Sittings/2026-09-15');
    expect(ref.blockId).toBeDefined();
    expect(v.text('Sittings/2026-09-15.md')).toContain(`fell over twice. ^${ref.blockId}`);
    expect(v.frontmatter('Sittings/2026-09-15.md')['answers']).toEqual(['[[Bank/craft#^b1]]']);
  });

  test('the block id lands on the FIRST paragraph of the answer, the link anchor', async () => {
    const v = markVault();
    const ref = await mark(v, asksIn(v)[0] as Ask);
    const lines = v.text('Sittings/2026-09-15.md').split('\n');
    const marked = lines.findIndex((l) => l.endsWith(`^${ref.blockId}`));
    expect(lines[marked]).toContain('I rigged a walk cycle');
  });

  test('the source is in Bank/, so it gains no inverse', async () => {
    const v = markVault();
    await mark(v, asksIn(v)[0] as Ask);
    expect(v.frontmatter('Bank/craft.md')).toEqual({ kind: 'bank' });
  });

  // Marking writes `answers` and nothing else. The Closing move a source may
  // call for is closing.ts's, run by the Interview: test/closing.test.ts holds
  // it, and test/interview.test.ts holds the chaining.
  test('marking a Bookmark writes no `next`: that is the Interview’s to run', async () => {
    const v = markVault();
    await mark(v, asksIn(v)[1] as Ask);
    expect(v.frontmatter('Domains/Blender.md')['next']).toBeUndefined();
  });

  test('marking twice writes the link once', async () => {
    const v = markVault();
    const first = await mark(v, asksIn(v)[0] as Ask);
    const again = await mark(v, asksIn(v)[0] as Ask);
    expect(again.blockId).toBe(first.blockId as string);
    expect(v.frontmatter('Sittings/2026-09-15.md')['answers']).toEqual(['[[Bank/craft#^b1]]']);
  });

  // The refusal is data, not a Notice: the caller is handed the line to say.
  test('an Ask with no answer under it refuses with a reason, and writes nothing', async () => {
    const v = markVault();
    const before = v.text('Sittings/2026-09-15.md');
    const marked = await markAnswered(v.app, v.file('Sittings/2026-09-15.md'), asksIn(v)[2] as Ask, opts);
    expect(marked).toEqual({ kind: 'refused', reason: 'No answer under this Ask yet.' });
    expect(v.text('Sittings/2026-09-15.md')).toBe(before);
    expect(v.writes).toHaveLength(0);
  });

  test('an Ask with no source link is malformed, and writes nothing', async () => {
    const v = markVault();
    const [ask] = parseAsks('> [!ask] a question with no from-line\n\nan answer');
    const marked = await markAnswered(v.app, v.file('Sittings/2026-09-15.md'), ask as Ask, opts);
    expect(marked).toEqual({ kind: 'refused', reason: 'This Ask has no source link; it is malformed.' });
    expect(v.writes).toHaveLength(0);
  });
});

// The kind of question a day held, kept on the day.
//
// The register was legible only on the QUESTION until 2026-09-18, and the
// question lives in the Bank — where about 70% of all answer-links converge,
// since seven draws in ten come from there. So the graph view showed a
// four-pointed star around the starter bank's four notes, and nothing about
// what kind of thinking a Sitting held was visible on the Sitting at all.
//
// An attribute, not a relation: no edge, no inverse, nothing added to the
// table CONTEXT.md cut to one row on 2026-09-17.
describe('the register of what was answered', () => {
  const opts = { bankFolder: 'Bank' };
  const SITTING = 'Sittings/2026-09-15.md';
  const asksIn = (v: ReturnType<typeof markVault>) => parseAsks(v.text(SITTING));

  test('lands on the note that answered it', async () => {
    const v = markVault();
    await markAnswered(v.app, v.file(SITTING), asksIn(v)[0] as Ask, opts);
    expect(v.frontmatter(SITTING)['registers']).toEqual(['episode']);
  });

  test('a day that answered two kinds carries both, in order', async () => {
    const v = markVault();
    await markAnswered(v.app, v.file(SITTING), asksIn(v)[0] as Ask, opts);
    // Re-read: processFrontMatter re-serialises the block and moves every line
    // below it, so the ranges parsed a moment ago are stale.
    await markAnswered(v.app, v.file(SITTING), asksIn(v)[1] as Ask, opts);
    expect(v.frontmatter(SITTING)['registers']).toEqual(['episode', 'intention']);
  });

  test('marking twice records the register once', async () => {
    const v = markVault();
    await markAnswered(v.app, v.file(SITTING), asksIn(v)[0] as Ask, opts);
    await markAnswered(v.app, v.file(SITTING), asksIn(v)[0] as Ask, opts);
    expect(v.frontmatter(SITTING)['registers']).toEqual(['episode']);
  });

  // A paragraph of the owner's own writing is not a Bank entry and has no
  // register. Nothing to record, and no empty property left behind.
  test('answering your own paragraph records nothing', async () => {
    const v = fakeVault({
      [SITTING]: ['---', '---', '', '## Asked', '', '> [!ask] what broke?', '> from [[Domains/Blender#^r1]]', '', 'The hips.', ''].join('\n'),
      'Domains/Blender.md': '---\ngathers: [blender]\n---\n\nI rig badly. ^r1\n',
    });
    await markAnswered(v.app, v.file(SITTING), parseAsks(v.text(SITTING))[0] as Ask, opts);
    expect(v.frontmatter(SITTING)['registers']).toBeUndefined();
  });
});
