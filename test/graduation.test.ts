import { describe, expect, test } from 'bun:test';
import { graduate } from '../src/graduation';
import type { PieceChoice } from '../src/graduation';
import { Refused } from '../src/refusal';
import { threadsOf } from '../src/threads';
import { fakeVault } from './fake-vault';

// Graduation: a Thread of a Sitting leaves it and becomes a Piece. The owner's
// words move verbatim, block ids and all; the questions become headings; every
// link to a block that moved follows it. The Sitting stays as the day's record
// and names where its words went.

const BODY = [
  '## Asked',
  '',
  '> [!ask] what are you saving up for?',
  '> from [[Bank/q#^b1]]',
  '',
  'A house by the river. ^a1',
  '',
  '> [!ask] how can you be more open?',
  '> from [[Bank/q#^b2]]',
  '',
  'I said yes to the dinner. ^a2',
  '',
  '> [!ask] why the river?',
  '> from [[Sittings/2026-09-15#^a1]]',
  '',
  'Because it keeps moving. ^a3',
  '',
  'And I do not.',
  '',
  '> [!ask] what moves you, then?',
  '> from [[Sittings/2026-09-15#^a3]]',
  '',
  'People who stay. ^a4',
  '',
  '## Closing',
  '',
  '> [!ask] where should we pick up?',
  '> from [[Bank/closing#^x-005]]',
  '',
].join('\n');

const FRONT = ['---', 'answers:', '  - "[[Bank/q#^b1]]"', '  - "[[Bank/q#^b2]]"', '  - "[[Sittings/2026-09-15#^a1]]"', '  - "[[Sittings/2026-09-15#^a3]]"', '---', ''].join('\n');
const SITTING = 'Sittings/2026-09-15.md';

function vault() {
  return fakeVault({
    [SITTING]: FRONT + BODY,
    'me.md': '---\nnext: "[[Sittings/2026-09-15#^a4]]"\n---\n\nThe self.\n',
    'Sittings/2026-09-20.md': '## Asked\n\n> [!ask] what still moves?\n> from [[Sittings/2026-09-15#^a3]]\n> ![[Sittings/2026-09-15#^a3]]\n\nThe dinner, ![[Sittings/2026-09-15#^a2]]\n',
    'Pieces/old.md': 'An older Piece.\n',
  });
}

const here = (path: string) => path === 'Sittings/2026-09-15';
const bookmark = (ref: string) => ref === 'Bank/closing#^x-005';

function setUp() {
  const v = vault();
  const snapshot = v.text(SITTING);
  const [river, open] = threadsOf(snapshot, here, bookmark);
  const run = (choices: (Omit<PieceChoice, 'thread'> & { thread?: PieceChoice['thread'] })[]) =>
    graduate(v.app, v.file(SITTING), snapshot, choices.map((c) => ({ thread: river!, ...c })));
  return { v, snapshot, river: river!, open: open!, run };
}

describe('a thread becomes a Piece', () => {
  test('the questions become headings and the answers move verbatim', async () => {
    const { v, run } = setUp();
    await run([{ title: 'The river', folder: 'Pieces' }]);
    expect(v.text('Pieces/The river.md')).toEndWith([
      '## what are you saving up for?',
      '',
      'A house by the river. ^a1',
      '',
      '## why the river?',
      '',
      'Because it keeps moving. ^a3',
      '',
      'And I do not.',
      '',
      '## what moves you, then?',
      '',
      'People who stay. ^a4',
      '',
    ].join('\n'));
  });

  test('it is read as a Piece: its title, its date, and what it answers', async () => {
    const { v, run } = setUp();
    await run([{ title: 'The river', folder: 'Pieces' }]);
    expect(v.frontmatter('Pieces/The river.md')).toEqual({
      title: 'The river',
      date: '2026-09-15',
      answers: ['[[Bank/q#^b1]]', '[[Pieces/The river#^a1]]', '[[Pieces/The river#^a3]]'],
    });
  });

  test('the Sitting keeps the rest of the day and names where the words went', async () => {
    const { v, run } = setUp();
    await run([{ title: 'The river', folder: 'Pieces' }]);
    const left = v.text(SITTING);
    expect(left).not.toContain('A house by the river');
    expect(left).not.toContain('People who stay');
    expect(left).toContain('I said yes to the dinner. ^a2');
    expect(left).toContain('## Closing');
    expect(v.frontmatter(SITTING)).toEqual({ answers: ['[[Bank/q#^b2]]'], graduated: ['[[Pieces/The river]]'] });
  });

  test('a heading the owner chose replaces its question; a blank one keeps the question', async () => {
    const { v, run } = setUp();
    await run([{ title: 'The river', folder: 'Pieces', headings: ['Saving up', ' ', 'What moves me'] }]);
    const text = v.text('Pieces/The river.md');
    expect(text).toContain('## Saving up\n');
    expect(text).toContain('## why the river?\n');
    expect(text).toContain('## What moves me\n');
  });

  test('two threads become two Pieces', async () => {
    const { v, open, run } = setUp();
    await run([{ title: 'The river', folder: 'Pieces' }, { thread: open, title: 'Saying yes', folder: 'Pieces' }]);
    expect(v.text('Pieces/Saying yes.md')).toEndWith('## how can you be more open?\n\nI said yes to the dinner. ^a2\n');
    expect(v.frontmatter(SITTING)['graduated']).toEqual(['[[Pieces/The river]]', '[[Pieces/Saying yes]]']);
    expect(v.frontmatter(SITTING)['answers']).toBeUndefined();
  });
});

describe('links follow the words', () => {
  test('a link to a moved block, in any note and in any form, points at the Piece', async () => {
    const { v, run } = setUp();
    await run([{ title: 'The river', folder: 'Pieces' }]);
    expect(v.frontmatter('me.md')['next']).toBe('[[Pieces/The river#^a4]]');
    const later = v.text('Sittings/2026-09-20.md');
    expect(later).toContain('> from [[Pieces/The river#^a3]]');
    expect(later).toContain('> ![[Pieces/The river#^a3]]');
  });

  test('a link to a block that stayed is not touched', async () => {
    const { v, run } = setUp();
    await run([{ title: 'The river', folder: 'Pieces' }]);
    expect(v.text('Sittings/2026-09-20.md')).toContain('![[Sittings/2026-09-15#^a2]]');
  });
});

describe('refusals write nothing', () => {
  test('a title already taken in that folder', async () => {
    const { v, run } = setUp();
    await expect(run([{ title: 'old', folder: 'Pieces' }])).rejects.toBeInstanceOf(Refused);
    expect(v.writes).toEqual([]);
  });

  test('two Pieces given the same title', async () => {
    const { v, open, run } = setUp();
    await expect(run([{ title: 'River', folder: 'Pieces' }, { thread: open, title: 'River', folder: 'Pieces' }])).rejects.toBeInstanceOf(Refused);
    expect(v.writes).toEqual([]);
  });

  test('no title', async () => {
    const { v, run } = setUp();
    await expect(run([{ title: '  ', folder: 'Pieces' }])).rejects.toBeInstanceOf(Refused);
    expect(v.writes).toEqual([]);
  });

  test('a Sitting that changed after it was read: the Pieces already made are taken back', async () => {
    const { v, run } = setUp();
    await v.app.vault.process(v.file(SITTING), (text) => text.replace('And I do not.', 'And I do not, yet.'));
    const edited = v.text(SITTING);
    await expect(run([{ title: 'The river', folder: 'Pieces' }])).rejects.toBeInstanceOf(Refused);
    expect(v.app.vault.getFileByPath('Pieces/The river.md')).toBeNull();
    expect(v.text(SITTING)).toBe(edited);
    expect(v.frontmatter('me.md')['next']).toBe('[[Sittings/2026-09-15#^a4]]');
  });
});

test('the file is named by the title, less what a file name cannot hold; the title keeps it all', async () => {
  const { v, run } = setUp();
  await run([{ title: 'River: why?', folder: 'Pieces' }]);
  expect(v.app.vault.getFileByPath('Pieces/River why.md')).not.toBeNull();
  expect(v.frontmatter('Pieces/River why.md')['title']).toBe('River: why?');
});
