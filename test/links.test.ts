// The Link invariant: "Every answer is linked at birth — `answers` on the
// answer, `answered-by` on the source. Exception: sources in Bank/ get no
// inverse." (CONTEXT.md, "Link")
//
// Nothing enforced this until 2026-09-16, because the fake vault had no
// frontmatter write to enforce it through.
//
// There were five relations and a reader for them until 2026-09-17. The four
// that were not `answers` produced ONE link in the vault's life, and the pane
// that read them is gone. What is left is the one relation that is not a
// nicety: it is what makes a source answered, so it is what stops the draw
// handing that source back.

import { describe, expect, test } from 'bun:test';
import { ANSWERED_BY, ANSWERS, answeredKeys, isBankPath, linkAnswer } from '../src/links';
import { parseRef } from '../src/refs';
import { fakeVault } from './fake-vault';

const SITTING = ['---', '---', '', '## Asked', '', 'The answer I wrote. ^a1', 'A second answer. ^a2', ''].join('\n');
const PIECE = ['---', 'title: Cities', 'status: published', '---', '', 'The buffaloes went past. ^p-004', ''].join('\n');

const vault = () =>
  fakeVault({
    'Sittings/2026-09-13.md': SITTING,
    'Pieces/cities.md': PIECE,
    'Bank/craft.md': '---\nkind: bank\n---\n\n- what did you make? #register/episode ^b1\n',
  });

const ref = (s: string) => parseRef(s) as NonNullable<ReturnType<typeof parseRef>>;
const opts = { bankFolder: 'Bank' };
const ANSWER = 'Sittings/2026-09-13#^a1';
const SOURCE = 'Pieces/cities#^p-004';

describe('both ends', () => {
  test('`answers` goes on the answer, `answered-by` on the source', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')[ANSWERS]).toEqual([`[[${SOURCE}]]`]);
    expect(v.frontmatter('Pieces/cities.md')[ANSWERED_BY]).toEqual([`[[${ANSWER}]]`]);
  });

  test('each end names the other end’s block, so the link is precise both ways', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE), opts);
    expect((v.frontmatter('Sittings/2026-09-13.md')[ANSWERS] as string[])[0]).toContain('#^p-004');
    expect((v.frontmatter('Pieces/cities.md')[ANSWERED_BY] as string[])[0]).toContain('#^a1');
  });

  test('the note the link points at keeps the properties it already had', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE), opts);
    expect(v.frontmatter('Pieces/cities.md')['title']).toBe('Cities');
    expect(v.frontmatter('Pieces/cities.md')['status']).toBe('published');
  });

  test('the same link written twice is written once', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE), opts);
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')[ANSWERS]).toEqual([`[[${SOURCE}]]`]);
    expect(v.frontmatter('Pieces/cities.md')[ANSWERED_BY]).toEqual([`[[${ANSWER}]]`]);
  });

  // This is what lets an answer be marked a second time to ask for another
  // Follow-up: nothing changes, so nothing is written twice.
  test('two answers to the same source are two entries on it', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE), opts);
    await linkAnswer(v.app, ref('Sittings/2026-09-13#^a2'), ref(SOURCE), opts);
    expect(v.frontmatter('Pieces/cities.md')[ANSWERED_BY]).toHaveLength(2);
  });

  test('one answer to two sources is two entries on the answer', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE), opts);
    await linkAnswer(v.app, ref(ANSWER), ref('Bank/craft#^b1'), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')[ANSWERS]).toEqual([`[[${SOURCE}]]`, '[[Bank/craft#^b1]]']);
  });
});

describe('the Bank exception', () => {
  test('an answer links its Bank question, and the Bank note gains nothing', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref('Bank/craft#^b1'), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')[ANSWERS]).toEqual(['[[Bank/craft#^b1]]']);
    // The backlink pane already shows it, and a bank note must not accumulate
    // hundreds of entries.
    expect(v.frontmatter('Bank/craft.md')[ANSWERED_BY]).toBeUndefined();
  });

  test('a source outside Bank/ does get the inverse: the exception is the folder', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE), opts);
    expect(v.frontmatter('Pieces/cities.md')[ANSWERED_BY]).toBeDefined();
  });

  test('isBankPath reads the configured folder, not the word', () => {
    expect(isBankPath('Bank/craft.md', 'Bank')).toBe(true);
    expect(isBankPath('Questions/craft.md', 'Questions')).toBe(true);
    expect(isBankPath('Banks of the river.md', 'Bank')).toBe(false);
  });
});

describe('what counts as answered', () => {
  test('answeredKeys resolves every `answers` link of a note', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE), opts);
    await linkAnswer(v.app, ref(ANSWER), ref('Bank/craft#^b1'), opts);
    expect(answeredKeys(v.app, v.file('Sittings/2026-09-13.md')).sort()).toEqual([
      'Bank/craft.md#^b1',
      'Pieces/cities.md#^p-004',
    ]);
  });

  test('a note that answers nothing has no keys, however many properties it carries', () => {
    const v = vault();
    expect(answeredKeys(v.app, v.file('Pieces/cities.md'))).toEqual([]);
  });

  // The inverse is NOT an answer: only the forward property counts, or a
  // source would read as answered by its own backlink.
  test('the source is not made answered by carrying `answered-by`', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE), opts);
    expect(answeredKeys(v.app, v.file('Pieces/cities.md'))).toEqual([]);
  });
});
