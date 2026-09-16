import { describe, expect, test } from 'bun:test';
import { appendAsk, parseAsks } from '../src/asks';

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
