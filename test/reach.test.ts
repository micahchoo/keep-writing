import { describe, expect, test } from 'bun:test';
import { paragraphJar, paragraphsByFolder } from '../src/paragraphs';
import { folderChoices } from '../src/settings';
import { fakeVault } from './fake-vault';

// Reach: how much of the owner's writing the draw can put in front of them.
// The folder picker showed bare names until 2026-09-29, and the only writing
// folder a fresh install names is its empty daily-notes folder, so the one
// thing keep-writing does that nothing else does stayed off, unannounced.
// Measured on a Notion export: 0 paragraphs reachable, 39,049 one click away.

const P = (s: string) => `${s} is a sentence long enough to be read as a paragraph of prose.`;

describe('paragraphsByFolder', () => {
  const v = fakeVault({
    'Notion/a.md': `${P('One')}\n\n${P('Two')} ^t\n`,
    'Notion/Deep/b.md': `# Heading\n\n${P('Three')}\n\n- a list item\n`,
    'Notion/index.md': `---\nstatus: page\n---\n\n${P('Furniture')}\n`,
    'Sittings/2026-09-29.md': '## Asked\n',
    'top.md': `${P('Loose')}\n`,
  });

  test('counts what the jar would hold, and a note counts in every folder above it', () => {
    const counts = paragraphsByFolder(v.app);
    expect(counts.get('Notion')).toBe(3);
    expect(counts.get('Notion/Deep')).toBe(1);
    expect(counts.get('Sittings') ?? 0).toBe(0);
    expect(counts.get('Notion')).toBe(paragraphJar(v.app, ['Notion']).length);
  });
});

describe('folderChoices', () => {
  test('the most writing first, empty folders last, each with its count', () => {
    const counts = new Map([['Notion', 39049], ['Notion/Deep', 12], ['Pieces', 722]]);
    expect(folderChoices(['Archive', 'Notion', 'Notion/Deep', 'Pieces', 'Sittings'], ['Sittings'], counts)).toEqual([
      ['Notion', 'Notion · 39,049 paragraphs'],
      ['Pieces', 'Pieces · 722 paragraphs'],
      ['Notion/Deep', 'Notion/Deep · 12 paragraphs'],
      ['Archive', 'Archive · no paragraphs yet'],
    ]);
  });
});
