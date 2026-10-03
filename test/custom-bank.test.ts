import { describe, expect, test } from 'bun:test';
import { bankJar, loadBank, questionAt } from '../src/bank';
import type { DrawContext } from '../src/bank';
import { virtualId } from '../src/refs';
import { fakeVault } from './fake-vault';

// The Custom bank is the one Bank note where a plain list line is a question.
// Everywhere else an id is an address something else holds; in Custom the
// owner types a line, on a phone or mid-answer, and it exists. Its address is
// its Virtual id, over the question's words with tags and `due:` removed.

const BANK = '---\nkind: bank\n---\n';

function ctx(app: DrawContext['app']): DrawContext {
  return { app, bankFolder: 'Bank', sittingsFolder: 'Sittings', writingFolders: [], skipped: new Set() };
}

describe('the Custom bank', () => {
  test('a plain line is a question, addressed by the Virtual id of its words', async () => {
    const v = fakeVault({ 'Bank/Custom.md': `${BANK}- what did my father never say out loud?\n` });
    const [q] = await loadBank(v.app, v.file('Bank/Custom.md'), 'Bank');
    expect(q?.text).toBe('what did my father never say out loud?');
    expect(q?.ref).toEqual({ path: 'Bank/Custom', blockId: virtualId('what did my father never say out loud?') });
    expect(q?.key).toBe(`Bank/Custom.md#^${virtualId('what did my father never say out loud?')}`);
  });

  test('a tag or a due date does not move the address; a changed word does', async () => {
    const plain = fakeVault({ 'Bank/Custom.md': `${BANK}- what did I stop believing?\n` });
    const tagged = fakeVault({ 'Bank/Custom.md': `${BANK}- what did I stop believing? #register/belief due: +7d\n` });
    const edited = fakeVault({ 'Bank/Custom.md': `${BANK}- what did I stop believing in?\n` });
    const id = async (v: ReturnType<typeof fakeVault>) => (await loadBank(v.app, v.file('Bank/Custom.md'), 'Bank'))[0]?.ref.blockId;
    expect(await id(tagged)).toBe(await id(plain));
    expect(await id(edited)).not.toBe(await id(plain));
  });

  test('a line that carries an id keeps it', async () => {
    const v = fakeVault({ 'Bank/Custom.md': `${BANK}- a question with an id? ^own1\n- one without?\n` });
    const ids = (await loadBank(v.app, v.file('Bank/Custom.md'), 'Bank')).map((q) => q.ref.blockId);
    expect(ids).toEqual(['own1', virtualId('one without?')]);
  });

  test('a plain line in any other bank note is not a question', async () => {
    const v = fakeVault({
      'Bank/travel.md': `${BANK}- where did you get lost? ^t1\n- and this one has no id?\n`,
      'Bank/sub/Custom.md': `${BANK}- not the Custom bank, only its name?\n`,
    });
    expect((await loadBank(v.app, v.file('Bank/travel.md'), 'Bank')).map((q) => q.text)).toEqual(['where did you get lost?']);
    expect(await loadBank(v.app, v.file('Bank/sub/Custom.md'), 'Bank')).toEqual([]);
  });

  test('an answer retires a plain line from the Bank jar', async () => {
    const asked = 'what did my father never say out loud?';
    const v = fakeVault({
      'Bank/Custom.md': `${BANK}- ${asked}\n- what do my hands remember?\n`,
      'Sittings/2026-10-03.md': `---\nanswers:\n- "[[Bank/Custom#^${virtualId(asked)}]]"\n---\n\nHe never said sorry. ^a1\n`,
    });
    expect((await bankJar(ctx(v.app), null)).map((q) => q.text)).toEqual(['what do my hands remember?']);
  });

  test('an Ask citing a plain line finds its question', async () => {
    const v = fakeVault({ 'Bank/Custom.md': `${BANK}- where should we pick up? #role/bookmark\n` });
    const ref = { path: 'Bank/Custom', blockId: virtualId('where should we pick up?') };
    expect((await questionAt(v.app, ref, 'Sittings/x.md', 'Bank'))?.role).toBe('bookmark');
  });
});
