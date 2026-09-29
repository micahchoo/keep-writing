import { describe, expect, test } from 'bun:test';
import { CRAFT_LENS, INVITATION_LENS, MAX_LENS_WORDS, lensProblem, lensText, lensWords, readLens } from '../src/lens';

// A Lens is a setting since 2026-09-28: a short steer the owner edits, added
// to the composer's prompt. It was a note in `Lenses/` before, which only this
// vault ever had, so every other install composed with no Lens at all.

describe('the shipped Lenses', () => {
  test('each fits the limit it asks the owner to keep', () => {
    for (const lens of [CRAFT_LENS, INVITATION_LENS]) {
      expect(lensWords(lens)).toBeGreaterThan(0);
      expect(lensWords(lens)).toBeLessThanOrEqual(MAX_LENS_WORDS);
    }
  });
});

describe('the word limit', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

  test('words are counted across lines and runs of spaces', () => {
    expect(lensWords('  Ask what\n\nhappened,   in order. ')).toBe(5);
    expect(lensWords('')).toBe(0);
  });

  test('up to the limit is accepted; one over is refused, and says by how much', () => {
    expect(lensProblem(words(MAX_LENS_WORDS))).toBeUndefined();
    expect(lensProblem(words(MAX_LENS_WORDS + 1))).toBe(`This is ${MAX_LENS_WORDS + 1} words. Keep it to ${MAX_LENS_WORDS} or fewer.`);
  });

  // `validate` guards the box, not data.json. A stored Lens over the limit is
  // one the tab would have refused, so it is not used.
  test('what is stored is read clean: over the limit, or not text, is no Lens of the owner’s', () => {
    expect(readLens('  Ask about now.  ')).toBe('Ask about now.');
    expect(readLens(words(MAX_LENS_WORDS + 1))).toBe('');
    expect(readLens(42)).toBe('');
    expect(readLens(undefined)).toBe('');
  });
});

describe('lensText', () => {
  test('the owner’s Lens when there is one; the shipped one when the box is empty', () => {
    expect(lensText('Ask about the tools.', CRAFT_LENS)).toBe('Ask about the tools.');
    expect(lensText('', CRAFT_LENS)).toBe(CRAFT_LENS);
    expect(lensText('   ', INVITATION_LENS)).toBe(INVITATION_LENS);
  });
});
