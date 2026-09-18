// The Link invariant: "Every relation is written on both ends — the forward
// property on the source note, the inverse property on the target note.
// Exception: targets in Bank/ get no inverse." (CONTEXT.md, "Link")
//
// Nothing enforced this until 2026-09-16, because the fake vault had no
// frontmatter write to enforce it through.

import { describe, expect, test } from 'bun:test';
import { INVERSE, RELATIONS, isRelation, isSymmetric, linkBoth, linksOf, relationOfKey, unlinkBoth } from '../src/links';
import { parseRef } from '../src/refs';
import { fakeVault } from './fake-vault';

const SITTING = ['---', 'about: "[[Blender]]"', '---', '', '## Asked', '', 'The answer I wrote. ^a1', ''].join('\n');
const PIECE = ['---', 'title: Cities', 'status: published', '---', '', 'The buffaloes went past. ^p-004', ''].join('\n');
const OTHER = ['---', 'title: Rivers', 'status: published', '---', '', 'The river was low. ^p-009', ''].join('\n');

const vault = () =>
  fakeVault({
    'Sittings/2026-09-13.md': SITTING,
    'Pieces/cities.md': PIECE,
    'Pieces/rivers.md': OTHER,
    'Domains/Blender.md': '---\ngathers: [blender]\n---\n\nI rig badly. ^r1\n',
    'Bank/craft.md': '---\nkind: bank\n---\n\n- what did you make? #register/episode ^b1\n',
  });

const ref = (s: string) => parseRef(s) as NonNullable<ReturnType<typeof parseRef>>;
const opts = { bankFolder: 'Bank' };
const ANSWER = 'Sittings/2026-09-13#^a1';

describe('the relation table', () => {
  test('every relation has an inverse, and both names read back to it', () => {
    for (const r of RELATIONS) {
      expect(INVERSE[r]).toBeTruthy();
      expect(relationOfKey(r)).toEqual({ relation: r, inverse: false });
      // A symmetric relation's two names are one name, so it never reads as
      // an inverse: there is no second property to tell apart.
      expect(relationOfKey(INVERSE[r])).toEqual({ relation: r, inverse: !isSymmetric(r) });
    }
  });

  test('a relation whose inverse is its own name is symmetric', () => {
    expect(RELATIONS.filter(isSymmetric)).toEqual(['echoes', 'contradicts']);
    expect(RELATIONS.filter((r) => !isSymmetric(r))).toEqual(['answers', 'follows', 'demonstrates']);
  });

  test('a numbered property is the same relation: Obsidian keys a list `echoes.0`', () => {
    expect(relationOfKey('echoes.0')).toEqual({ relation: 'echoes', inverse: false });
    expect(relationOfKey('answered-by.2')).toEqual({ relation: 'answers', inverse: true });
  });

  test('a property that is not a relation is not one', () => {
    expect(relationOfKey('about')).toBeNull();
    expect(relationOfKey('next')).toBeNull();
    expect(isRelation('answers')).toBe(true);
    expect(isRelation('answered-by')).toBe(false);
  });
});

describe('both ends', () => {
  test('the forward property goes on the source, the inverse on the target', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')['echoes']).toEqual(['[[Pieces/cities#^p-004]]']);
    expect(v.frontmatter('Pieces/cities.md')['echoes']).toEqual([`[[${ANSWER}]]`]);
  });

  test('the inverse is the inverse, not the relation: follows ↔ precedes', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'follows', ref('Pieces/cities#^p-004'), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')['follows']).toEqual(['[[Pieces/cities#^p-004]]']);
    expect(v.frontmatter('Pieces/cities.md')['precedes']).toEqual([`[[${ANSWER}]]`]);
    expect(v.frontmatter('Pieces/cities.md')['follows']).toBeUndefined();
  });

  test('each end names the other end’s block, so the link is block-precise both ways', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'contradicts', ref('Pieces/rivers#^p-009'), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')['contradicts']).toEqual(['[[Pieces/rivers#^p-009]]']);
    expect(v.frontmatter('Pieces/rivers.md')['contradicts']).toEqual(['[[Sittings/2026-09-13#^a1]]']);
  });

  test('the note the link points at keeps the properties it already had', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    const fm = v.frontmatter('Pieces/cities.md');
    expect(fm['title']).toBe('Cities');
    expect(fm['status']).toBe('published');
    expect(v.text('Pieces/cities.md')).toContain('The buffaloes went past. ^p-004');
  });

  test('a second relation to the same note is a second property, not a replacement', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    await linkBoth(v.app, ref(ANSWER), 'follows', ref('Pieces/cities#^p-004'), opts);
    const fm = v.frontmatter('Sittings/2026-09-13.md');
    expect(fm['echoes']).toEqual(['[[Pieces/cities#^p-004]]']);
    expect(fm['follows']).toEqual(['[[Pieces/cities#^p-004]]']);
  });

  test('the same link written twice is written once', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')['echoes']).toEqual(['[[Pieces/cities#^p-004]]']);
    expect(v.frontmatter('Pieces/cities.md')['echoes']).toEqual([`[[${ANSWER}]]`]);
  });

  test('two targets under one relation are two entries', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/rivers#^p-009'), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')['echoes']).toEqual([
      '[[Pieces/cities#^p-004]]',
      '[[Pieces/rivers#^p-009]]',
    ]);
  });
});

describe('the Bank exception', () => {
  test('an answer links its Bank question, and the Bank note gains nothing', async () => {
    const v = vault();
    const before = v.text('Bank/craft.md');
    await linkBoth(v.app, ref(ANSWER), 'answers', ref('Bank/craft#^b1'), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')['answers']).toEqual(['[[Bank/craft#^b1]]']);
    expect(v.frontmatter('Bank/craft.md')['answered-by']).toBeUndefined();
    expect(v.text('Bank/craft.md')).toBe(before);
  });

  test('a target outside Bank/ does get the inverse: the exception is the folder, not the relation', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'answers', ref('Domains/Blender#^r1'), opts);
    expect(v.frontmatter('Domains/Blender.md')['answered-by']).toEqual([`[[${ANSWER}]]`]);
  });
});

describe('unlinking', () => {
  test('takes both ends away', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    await unlinkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')['echoes']).toBeUndefined();
    expect(v.frontmatter('Pieces/cities.md')['echoes']).toBeUndefined();
  });

  test('the last entry takes the property with it; the others stay', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/rivers#^p-009'), opts);
    await unlinkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')['echoes']).toEqual(['[[Pieces/rivers#^p-009]]']);
    expect(v.frontmatter('Pieces/cities.md')['echoes']).toBeUndefined();
    expect(v.frontmatter('Pieces/rivers.md')['echoes']).toEqual([`[[${ANSWER}]]`]);
  });

  test('a note-level unlink takes every block of that note', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/rivers#^p-009'), opts);
    await unlinkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities'), opts);
    expect(v.frontmatter('Sittings/2026-09-13.md')['echoes']).toEqual(['[[Pieces/rivers#^p-009]]']);
  });

  test('unlinking what was never linked changes nothing', async () => {
    const v = vault();
    const before = v.text('Sittings/2026-09-13.md');
    await unlinkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    expect(v.text('Sittings/2026-09-13.md')).toBe(before);
  });
});

describe('what the Links pane reads', () => {
  test('a written link is one out-row here and one in-row there', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'follows', ref('Pieces/cities#^p-004'), opts);

    const out = linksOf(v.app, v.file('Sittings/2026-09-13.md'));
    expect(out).toHaveLength(1);
    expect(out[0]?.relation).toBe('follows');
    expect(out[0]?.direction).toBe('out');
    expect(out[0]?.otherPath).toBe('Pieces/cities.md');
    expect(out[0]?.ref.blockId).toBe('p-004');
    // Which block HERE the link came from, read off the inverse on the target.
    expect(out[0]?.ownBlockId).toBe('a1');

    const back = linksOf(v.app, v.file('Pieces/cities.md'));
    expect(back).toHaveLength(1);
    expect(back[0]?.relation).toBe('follows');
    expect(back[0]?.direction).toBe('in');
    expect(back[0]?.otherPath).toBe('Sittings/2026-09-13.md');
    expect(back[0]?.ownBlockId).toBe('p-004');
  });

  test('a symmetric relation is one row at each end, pointing both ways', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    // `echoes` is its own inverse, so each note holds a forward-named property
    // AND is the destination of one. Two readings, one link, one row.
    const there = linksOf(v.app, v.file('Pieces/cities.md'));
    expect(there).toHaveLength(1);
    expect(there[0]?.direction).toBe('both');
    expect(there[0]?.ref.blockId).toBe('a1');
    expect(there[0]?.ownBlockId).toBe('p-004');

    const here = linksOf(v.app, v.file('Sittings/2026-09-13.md'));
    expect(here).toHaveLength(1);
    expect(here[0]?.direction).toBe('both');
    expect(here[0]?.ref.blockId).toBe('p-004');
    expect(here[0]?.ownBlockId).toBe('a1');
  });

  test('a one-way relation keeps its direction: out here, in there', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'demonstrates', ref('Pieces/rivers#^p-009'), opts);
    expect(linksOf(v.app, v.file('Sittings/2026-09-13.md'))[0]?.direction).toBe('out');
    expect(linksOf(v.app, v.file('Pieces/rivers.md'))[0]?.direction).toBe('in');
  });

  test('a Bank target has no inverse, so its row is only visible from the answer', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'answers', ref('Bank/craft#^b1'), opts);
    const rows = linksOf(v.app, v.file('Sittings/2026-09-13.md'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.direction).toBe('out');
    // Nothing on the Bank side says which block asked, so this stays unknown.
    expect(rows[0]?.ownBlockId).toBeUndefined();
    // The exception is about what is WRITTEN into a bank note, so that it does
    // not accumulate hundreds of entries. The pane still derives the incoming
    // row from the answer's own property; nothing is stored on the Bank side.
    expect(v.frontmatter('Bank/craft.md')).toEqual({ kind: 'bank' });
  });

  test('a note with no typed links has no rows, however many other properties it carries', () => {
    const v = vault();
    expect(linksOf(v.app, v.file('Pieces/rivers.md'))).toHaveLength(0);
  });

  test('two relations between the same pair stay two rows', async () => {
    const v = vault();
    await linkBoth(v.app, ref(ANSWER), 'echoes', ref('Pieces/cities#^p-004'), opts);
    await linkBoth(v.app, ref(ANSWER), 'follows', ref('Pieces/cities#^p-004'), opts);
    const rows = linksOf(v.app, v.file('Sittings/2026-09-13.md'));
    expect(rows.map((r) => r.relation).sort()).toEqual(['echoes', 'follows']);
  });
});
