import { describe, expect, test } from 'bun:test';
import type { App, TFile } from 'obsidian';
import { isFinishedPiece, isRevisitable } from '../src/target';

// What a Piece's `status` means to the draw.
//
// Gathering lived here too — how a Domain claimed the Pieces about it by tag —
// until 2026-09-17. It existed to file paragraphs under Wells, and Wells were
// deleted with the draw skew they caused. `gathers:` stays in the Domain notes
// as ordinary Obsidian tags that no code reads.
describe('isRevisitable', () => {
  // A stub for two pure reads: both functions touch one frontmatter property
  // and the note's path, and nothing else of `App`.
  const app = (status: unknown) =>
    ({
      metadataCache: { getFileCache: () => ({ frontmatter: status === undefined ? {} : { status } }) },
    }) as unknown as App;
  const piece = { path: 'Pieces/2021-x.md', basename: '2021-x', extension: 'md' } as unknown as TFile;
  test('published and set-down are revisitable', () => {
    expect(isRevisitable(app('published'), piece)).toBe(true);
    expect(isRevisitable(app('set-down'), piece)).toBe(true);
  });
  test('a page is finished but never revisited', () => {
    expect(isFinishedPiece(app('page'), piece)).toBe(true);
    expect(isRevisitable(app('page'), piece)).toBe(false);
  });
  test('an open Piece is neither', () => {
    expect(isFinishedPiece(app(undefined), piece)).toBe(false);
    expect(isRevisitable(app(undefined), piece)).toBe(false);
  });
});
