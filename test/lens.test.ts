import { describe, expect, test } from 'bun:test';
import { CRAFT_LENS, FOLLOW_UP_LENS, INVITATION_LENS, INVITATION_WHERE, LENS_VERSION, MAX_LENS_WORDS, MAX_STANCE_WORDS, REVISIT_WHERE, STANCE, lensProblem, lensText, lensWords, readLens, upgradeLens } from '../src/lens';

// A Lens is a setting since 2026-09-28: a short steer the owner edits, added
// to the composer's prompt. It was a note in `Lenses/` before, which only this
// vault ever had, so every other install composed with no Lens at all.

describe('the shipped Lenses', () => {
  test('each fits the limit it asks the owner to keep', () => {
    for (const lens of [CRAFT_LENS, INVITATION_LENS, FOLLOW_UP_LENS]) {
      expect(lensWords(lens)).toBeGreaterThan(0);
      expect(lensWords(lens)).toBeLessThanOrEqual(MAX_LENS_WORDS);
    }
    expect(lensWords(STANCE)).toBeLessThanOrEqual(MAX_STANCE_WORDS);
  });

  test('a Lens holds its where-to-look list, and the owner can see and change it', () => {
    expect(CRAFT_LENS.startsWith(REVISIT_WHERE)).toBe(true);
    expect(INVITATION_LENS.startsWith(INVITATION_WHERE)).toBe(true);
  });
});

// Until 2026-09-29 the where-to-look list was fixed in the prompt and a Lens
// was appended after it. The box holds the list now, so a Lens edited before
// would replace the list if read as it is. It is read with the list in front.
describe('a Lens edited before the list moved into it', () => {
  test('keeps the list it was written after', () => {
    expect(upgradeLens('Ask about the tools.', REVISIT_WHERE, undefined)).toBe(`${REVISIT_WHERE}\n\nAsk about the tools.`);
  });
  test('an empty one stays empty, meaning the shipped Lens', () => {
    expect(upgradeLens('', REVISIT_WHERE, undefined)).toBe('');
    expect(upgradeLens(undefined, REVISIT_WHERE, undefined)).toBe(undefined);
  });
  test('one written since is left alone', () => {
    expect(upgradeLens('Ask about the tools.', REVISIT_WHERE, LENS_VERSION)).toBe('Ask about the tools.');
  });
});

describe('the word limit', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

  test('words are counted across lines and runs of spaces', () => {
    expect(lensWords('  Ask what\n\nhappened,   in order. ')).toBe(5);
    expect(lensWords('')).toBe(0);
  });

  test('the Stance has its own, shorter limit', () => {
    expect(lensProblem(words(MAX_STANCE_WORDS), MAX_STANCE_WORDS)).toBeUndefined();
    expect(lensProblem(words(MAX_STANCE_WORDS + 1), MAX_STANCE_WORDS)).toBe(`This is ${MAX_STANCE_WORDS + 1} words. Keep it to ${MAX_STANCE_WORDS} or fewer.`);
    expect(readLens(words(MAX_STANCE_WORDS + 1), MAX_STANCE_WORDS)).toBe('');
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
