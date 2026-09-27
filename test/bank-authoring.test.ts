import { expect, test } from 'bun:test';
import { bankInstructions, bankName, createBank } from '../src/bank-authoring';
import { installBank } from '../src/install';
import { STARTER_BANK } from '../src/starter-bank';
import { fakeVault } from './fake-vault';

test('a selected install writes only selected banks and preserves existing questions', async () => {
  const v = fakeVault({ 'Bank/ordinary-life.md': 'My revised questions.' });
  const selected = STARTER_BANK.filter(bank => ['ordinary-life.md', 'learning.md'].includes(bank.name));
  const result = await installBank(v.app, 'Bank', selected);
  expect(result.written).toEqual(['learning.md']);
  expect(result.skipped).toEqual(['ordinary-life.md']);
  expect(v.text('Bank/ordinary-life.md')).toBe('My revised questions.');
  expect(v.app.vault.getMarkdownFiles().map(file => file.path).sort()).toEqual(['Bank/learning.md', 'Bank/ordinary-life.md']);
});

test('new bank names stay in the selected folder and accept an optional extension', () => {
  expect(bankName(' Garden.md ')).toBe('Garden');
  for (const name of ['', '..', '../garden', 'nested/garden', 'garden\\other', 'garden#part', 'garden\nother']) {
    expect(() => bankName(name)).toThrow();
  }
});

test('creating a bank writes the requested scaffold and refuses to overwrite it', async () => {
  const v = fakeVault({});
  const file = await createBank(v.app, 'Questions', 'Garden');
  expect(file.path).toBe('Questions/Garden.md');
  expect(v.frontmatter(file.path)).toEqual({ kind: 'bank', title: 'Garden' });
  expect(v.text(file.path)).toContain(bankInstructions('Questions', 'Garden'));
  const before = v.text(file.path);
  await expect(createBank(v.app, 'Questions', 'Garden.md')).rejects.toThrow('already exists');
  expect(v.text(file.path)).toBe(before);
  await expect(createBank(v.app, 'Questions', '../outside')).rejects.toThrow();
  expect(v.writes.length).toBe(1);
});
