import { describe, expect, test } from 'bun:test';
import { CRAFT, bodyOf, lensFor } from '../src/lens';
import { fakeVault } from './fake-vault';

describe('bodyOf', () => {
  test('drops the frontmatter and trims', () => {
    expect(bodyOf('---\nkind: lens\nfor: domain\n---\n\nLook for what happened.\n\n1. A moment.\n')).toBe(
      'Look for what happened.\n\n1. A moment.',
    );
  });
  test('no frontmatter: the whole text, trimmed', () => {
    expect(bodyOf('  prose only \n')).toBe('prose only');
  });
  test('a frontmatter with nothing after it is empty', () => {
    expect(bodyOf('---\nkind: lens\n---\n')).toBe('');
  });
});

describe('lensFor', () => {
  const vault = fakeVault({
    'Lenses/craft.md': '---\nkind: lens\n---\n\nLook for what happened, in order.\n',
  });

  // One Lens, whatever folder the paragraph came from. It was chosen by the
  // Well until 2026-09-17 — craft for a Domain, learning for a Learning note,
  // none for the self — which made how a paragraph is asked about a property
  // of where it is filed.
  test('reads the craft page by default', async () => {
    expect(CRAFT).toBe('craft');
    expect(await lensFor(vault.app)).toBe('Look for what happened, in order.');
  });

  test('a Lens note that is not there is empty, never a throw', async () => {
    expect(await lensFor(vault.app, 'nothing-here')).toBe('');
  });
});
