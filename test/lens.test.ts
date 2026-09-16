import { describe, expect, test } from 'bun:test';
import { bodyOf, lensFor, lensName } from '../src/lens';
import { SELF } from '../src/target';
import type { Well } from '../src/target';
import { fakeVault } from './fake-vault';

const domain: Well = { kind: 'domain', name: 'Cities', file: null };
const learning: Well = { kind: 'learning', name: 'Dutch', file: null };

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
    'Lenses/craft.md': '---\nkind: lens\nfor: domain\n---\n\nLook for what happened, in order.\n',
  });

  test('a Domain reads the craft Lens; its name is craft', async () => {
    expect(lensName(domain)).toBe('craft');
    expect(await lensFor(vault.app, domain)).toBe('Look for what happened, in order.');
  });
  test('a Learning note reads the learning Lens; missing file is empty', async () => {
    expect(lensName(learning)).toBe('learning');
    expect(await lensFor(vault.app, learning)).toBe('');
  });
  test('the self has no Lens', async () => {
    expect(lensName(SELF)).toBeNull();
    expect(await lensFor(vault.app, SELF)).toBe('');
  });
});
