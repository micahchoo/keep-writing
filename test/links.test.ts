// The Link invariant: "Every answer is linked at birth — `answers` on the
// answer." (CONTEXT.md, "Link")
//
// It was written on both ends until 2026-09-24, `answered-by` on the source
// too, except for a source in Bank/. Obsidian's backlink pane already shows
// that end, and the inverse doubled every write. What a note already carries
// is the owner's and stays.
//
// There were five relations and a reader for them until 2026-09-17. What is
// left is the one relation that is not a nicety: it is what makes a source
// answered, so it is what stops the draw handing that source back.

import { describe, expect, test } from 'bun:test';
import { ANSWERS, answeredKeys, linkAnswer } from '../src/links';
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
const ANSWER = 'Sittings/2026-09-13#^a1';
const SOURCE = 'Pieces/cities#^p-004';

describe('one end', () => {
  test('`answers` goes on the answer, naming the source block', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE));
    expect(v.frontmatter('Sittings/2026-09-13.md')[ANSWERS]).toEqual([`[[${SOURCE}]]`]);
  });

  test('the source note is not written', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE));
    expect(v.writes.map((w) => w.path)).toEqual(['Sittings/2026-09-13.md']);
    expect(v.frontmatter('Pieces/cities.md')).toEqual({ title: 'Cities', status: 'published' });
  });

  test('an `answered-by` a note already carries stays as it is', async () => {
    const v = fakeVault({
      'Sittings/2026-09-13.md': SITTING,
      'Pieces/cities.md': ['---', 'answered-by:', '  - "[[Sittings/2026-09-12#^old]]"', '---', '', 'The buffaloes went past. ^p-004', ''].join('\n'),
    });
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE));
    expect(v.frontmatter('Pieces/cities.md')['answered-by']).toEqual(['[[Sittings/2026-09-12#^old]]']);
  });

  // This is what lets an answer be marked a second time to ask for another
  // Follow-up: nothing changes, so nothing is written twice.
  test('the same link written twice is written once', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE));
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE));
    expect(v.frontmatter('Sittings/2026-09-13.md')[ANSWERS]).toEqual([`[[${SOURCE}]]`]);
  });

  test('one answer to two sources is two entries on the answer', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE));
    await linkAnswer(v.app, ref(ANSWER), ref('Bank/craft#^b1'));
    expect(v.frontmatter('Sittings/2026-09-13.md')[ANSWERS]).toEqual([`[[${SOURCE}]]`, '[[Bank/craft#^b1]]']);
  });
});

describe('what counts as answered', () => {
  test('answeredKeys resolves every `answers` link of a note', async () => {
    const v = vault();
    await linkAnswer(v.app, ref(ANSWER), ref(SOURCE));
    await linkAnswer(v.app, ref(ANSWER), ref('Bank/craft#^b1'));
    expect(answeredKeys(v.app, v.file('Sittings/2026-09-13.md')).sort()).toEqual([
      'Bank/craft.md#^b1',
      'Pieces/cities.md#^p-004',
    ]);
  });

  test('a note that answers nothing has no keys, however many properties it carries', () => {
    const v = vault();
    expect(answeredKeys(v.app, v.file('Pieces/cities.md'))).toEqual([]);
  });

});
