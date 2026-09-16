import { describe, expect, test } from 'bun:test';
import { ensureBlockId, paragraphAt } from '../src/blocks';
import { fakeVault } from './fake-vault';

// The one permitted body edit: a Domain paragraph drawn without an id gets
// one on accept, appended to its last line. Nothing else changes.

describe('ensureBlockId', () => {
  const note = '---\nkind: domain\n---\n\nI walk to think, and the city gives back a different thought each morning.\nEvery city has a poem.\n\nAlready marked. ^w1\n';

  test('appends an id to the last line of the paragraph and returns a block ref', async () => {
    const vault = fakeVault({ 'Domains/Cities.md': note });
    const ref = await ensureBlockId(vault.app, vault.file('Domains/Cities.md'), 4);
    expect(ref.path).toBe('Domains/Cities');
    expect(ref.blockId).toMatch(/^[a-z0-9]{6}$/);
    expect(vault.writes).toHaveLength(1);
    expect(vault.text('Domains/Cities.md')).toBe(
      `---\nkind: domain\n---\n\nI walk to think, and the city gives back a different thought each morning.\nEvery city has a poem. ^${ref.blockId}\n\nAlready marked. ^w1\n`,
    );
  });

  test('a paragraph that has an id is returned as is, with no write', async () => {
    const vault = fakeVault({ 'Domains/Cities.md': note });
    const ref = await ensureBlockId(vault.app, vault.file('Domains/Cities.md'), 7);
    expect(ref).toEqual({ path: 'Domains/Cities', blockId: 'w1' });
    expect(vault.writes).toHaveLength(0);
  });

  test('a line outside any paragraph is refused', async () => {
    const vault = fakeVault({ 'Domains/Cities.md': note });
    await expect(ensureBlockId(vault.app, vault.file('Domains/Cities.md'), 3)).rejects.toThrow('Put the cursor');
  });
});

describe('paragraphAt', () => {
  test('a list line resolves to its item', () => {
    const vault = fakeVault({ 'x.md': '- one ^a\n- two\n' });
    expect(paragraphAt(vault.app.metadataCache.getFileCache(vault.file('x.md')), 1)).toEqual({ start: 1, end: 1, id: undefined, type: 'list' });
  });
});
