import { describe, expect, test } from 'bun:test';
import { ensureSourceBlockId, blockAt } from '../src/blocks';
import { refOf } from '../src/refs';
import { fakeVault } from './fake-vault';

// The one permitted body edit: a paragraph drawn or pointed at without an id
// gets one on accept, appended to its last line. Nothing else changes.
//
// These drive the writer that ships. Until 2026-09-21 they drove a twin,
// `ensureBlockId(app, file, line)`, that nothing in the plugin called.

describe('ensureSourceBlockId', () => {
  const note = '---\nkind: domain\n---\n\nI walk to think, and the city gives back a different thought each morning.\nEvery city has a poem.\n\nAlready marked. ^w1\n';
  const walk = 'I walk to think, and the city gives back a different thought each morning.\nEvery city has a poem.';

  test('appends an id to the last line of the paragraph and returns a block ref', async () => {
    const vault = fakeVault({ 'Domains/Cities.md': note });
    const file = vault.file('Domains/Cities.md');
    const ref = await ensureSourceBlockId(vault.app, { file, ref: refOf(file), text: walk });
    expect(ref.path).toBe('Domains/Cities');
    expect(ref.blockId).toMatch(/^[a-z0-9]{6}$/);
    expect(vault.writes).toHaveLength(1);
    expect(vault.text('Domains/Cities.md')).toBe(
      `---\nkind: domain\n---\n\nI walk to think, and the city gives back a different thought each morning.\nEvery city has a poem. ^${ref.blockId}\n\nAlready marked. ^w1\n`,
    );
  });

  test('a paragraph that has an id is returned as is, with no write', async () => {
    const vault = fakeVault({ 'Domains/Cities.md': note });
    const file = vault.file('Domains/Cities.md');
    const ref = await ensureSourceBlockId(vault.app, { file, ref: refOf(file, 'w1'), text: 'Already marked.' });
    expect(ref).toEqual({ path: 'Domains/Cities', blockId: 'w1' });
    expect(vault.writes).toHaveLength(0);
  });

  test('words that are not in the note, or are in it twice, are refused', async () => {
    const vault = fakeVault({ 'Domains/Cities.md': note + '\nEvery city has a poem.\n' });
    const file = vault.file('Domains/Cities.md');
    await expect(ensureSourceBlockId(vault.app, { file, ref: refOf(file), text: 'Nowhere in the note.' })).rejects.toThrow('changed or is ambiguous');
    await expect(ensureSourceBlockId(vault.app, { file, ref: refOf(file), text: 'Every city has a poem.' })).rejects.toThrow('changed or is ambiguous');
    expect(vault.writes).toHaveLength(0);
  });

  test('a validator that says no stops the write', async () => {
    const vault = fakeVault({ 'Domains/Cities.md': note });
    const file = vault.file('Domains/Cities.md');
    await expect(ensureSourceBlockId(vault.app, { file, ref: refOf(file), text: walk }, () => false)).rejects.toThrow('changed or is ambiguous');
    expect(vault.writes).toHaveLength(0);
  });
});

describe('blockAt', () => {
  test('a list line resolves to its item', () => {
    const vault = fakeVault({ 'x.md': '- one ^a\n- two\n' });
    expect(blockAt(vault.app.metadataCache.getFileCache(vault.file('x.md')), 1)).toEqual({ start: 1, end: 1, id: undefined, type: 'list' });
  });
});

describe('block refs with lagging metadata', () => {
  test('returns the ID already present in current text instead of allocating a phantom ref', async () => {
    const v = fakeVault({ 'x.md': 'Original paragraph.\n' });
    const file = v.file('x.md');
    const cache = v.app.metadataCache.getFileCache(file);
    await v.app.vault.process(file, () => 'Original paragraph. ^actual\n');
    v.app.metadataCache.getFileCache = () => cache;
    const ref = await ensureSourceBlockId(v.app, { file, ref: refOf(file), text: 'Original paragraph.' });
    expect(ref.blockId).toBe('actual');
    expect(v.text('x.md')).toBe('Original paragraph. ^actual\n');
  });
  test('refuses a paragraph that disappeared before the write', async () => {
    const v = fakeVault({ 'x.md': 'First.\n\nSecond.\n' });
    const file = v.file('x.md');
    const cache = v.app.metadataCache.getFileCache(file);
    await v.app.vault.process(file, () => 'First.\n');
    v.app.metadataCache.getFileCache = () => cache;
    await expect(ensureSourceBlockId(v.app, { file, ref: refOf(file), text: 'Second.' })).rejects.toThrow('changed');
    expect(v.text('x.md')).toBe('First.\n');
  });
  test('preserves CRLF and trailing spaces while appending the ID', async () => {
    const v = fakeVault({ 'x.md': 'Paragraph.  \r\n' });
    const file = v.file('x.md');
    const ref = await ensureSourceBlockId(v.app, { file, ref: refOf(file), text: 'Paragraph.' });
    expect(v.text('x.md')).toBe(`Paragraph.   ^${ref.blockId}\r\n`);
  });
});
