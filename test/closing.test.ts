// The Closing: the two moves at the end of a Sitting. Run by the Interview
// once an answer is linked, so a Bank entry's Role never reaches the callout
// parser (see the header of src/asks.ts).

import { describe, expect, test } from 'bun:test';
import { runClosing } from '../src/closing';
import { parseRef } from '../src/refs';
import { fakeVault } from './fake-vault';

const SITTING = 'Sittings/2026-09-15.md';
const ANSWER = { path: 'Sittings/2026-09-15', blockId: 'a1' };

/** `about` decides where a Bookmark lands; without it the bookmark goes to `me`. */
const vault = (about = 'about: "[[Blender]]"\n') =>
  fakeVault({
    [SITTING]: `---\n${about}---\n\n## Asked\n\nThe hips broke. ^a1\n`,
    'Domains/Blender.md': '---\ngathers: [blender]\n---\n\nI rig badly.\n',
    'me.md': '---\ntitle: me\n---\n\nThe self.\n',
    'Bank/closing.md':
      '---\nkind: bank\n---\n\n- where should we pick up? #register/intention #role/bookmark ^bm1\n- what did we not touch today? #register/general-event #role/door ^dr1\n',
    // A Role is declared on the ENTRY, never by the file it sits in.
    'Bank/craft.md':
      '---\nkind: bank\n---\n\n- what did you make? #register/episode ^b1\n- where were we? #register/intention #role/bookmark ^b2\n',
  });

const ref = (text: string) => parseRef(text) as { path: string; blockId?: string };
const run = (v: ReturnType<typeof vault>, source: string) =>
  runClosing(v.app, v.file(SITTING), ref(source), ANSWER, 'Bank');

describe('the Closing', () => {
  test('a Bookmark writes `next` on the Sitting’s Target', async () => {
    const v = vault();
    expect(await run(v, 'Bank/closing#^bm1')).toBe('bookmark');
    expect(v.frontmatter('Domains/Blender.md')['next']).toBe('[[Sittings/2026-09-15#^a1]]');
    expect(v.frontmatter('me.md')['next']).toBeUndefined();
  });

  test('roaming, the Bookmark lands on `me`', async () => {
    const v = vault('');
    expect(await run(v, 'Bank/closing#^bm1')).toBe('bookmark');
    expect(v.frontmatter('me.md')['next']).toBe('[[Sittings/2026-09-15#^a1]]');
  });

  test('an open door is an ordinary answer: the move is named, nothing is written', async () => {
    const v = vault();
    expect(await run(v, 'Bank/closing#^dr1')).toBe('door');
    expect(v.writes).toHaveLength(0);
  });

  test('an ordinary Bank question is no Closing move at all', async () => {
    const v = vault();
    expect(await run(v, 'Bank/craft#^b1')).toBeNull();
    expect(v.writes).toHaveLength(0);
  });

  test('a paragraph source is no Closing move: only a Bank entry carries a Role', async () => {
    const v = vault();
    expect(await run(v, 'Domains/Blender')).toBeNull();
    expect(v.writes).toHaveLength(0);
  });

  test('a Bookmark kept outside closing.md still runs: the Role is on the entry', async () => {
    const v = vault();
    expect(await run(v, 'Bank/craft#^b2')).toBe('bookmark');
    expect(v.frontmatter('Domains/Blender.md')['next']).toBe('[[Sittings/2026-09-15#^a1]]');
  });
});
