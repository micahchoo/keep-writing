// A Refusal is the owner's line. Anything else thrown is a defect, and must
// not reach them wearing a refusal's clothes.

import { describe, expect, test } from 'bun:test';
import { NotAParagraph } from '../src/blocks';
import { Refused, modelFailureLine, refusalLine } from '../src/refusal';
import { NotSelectable } from '../src/selection';

/** Run `fn` with console.error captured, so a defect's log can be asserted. */
function capturingErrors<T>(fn: () => T): { value: T; logged: number } {
  const real = console.error;
  let logged = 0;
  console.error = () => {
    logged++;
  };
  try {
    return { value: fn(), logged };
  } finally {
    console.error = real;
  }
}

describe('a refusal', () => {
  test('says itself: the message is the line the owner reads', () => {
    expect(refusalLine(new Refused('Select the words to ask about first.'))).toBe(
      'Select the words to ask about first.',
    );
  });

  test('every refusal the plugin raises is one', () => {
    expect(new NotAParagraph('Put the cursor in a paragraph.')).toBeInstanceOf(Refused);
    expect(new NotSelectable('Select inside a paragraph or a list item.')).toBeInstanceOf(Refused);
  });

  test('a defect is not guidance: it is said as a defect, and logged', () => {
    const { value, logged } = capturingErrors(() =>
      refusalLine(new TypeError("Cannot read properties of undefined (reading 'path')")),
    );
    expect(value).toBe('Something went wrong. See the developer console.');
    expect(value).not.toContain('undefined');
    expect(logged).toBe(1);
  });

  test('something thrown that is not an Error at all is a defect too', () => {
    const { value, logged } = capturingErrors(() => refusalLine('boom'));
    expect(value).toBe('Something went wrong. See the developer console.');
    expect(logged).toBe(1);
  });

  test('a refusal is never logged: it is not a defect', () => {
    const { logged } = capturingErrors(() => refusalLine(new NotSelectable('Select the words first.')));
    expect(logged).toBe(0);
  });
});

describe('modelFailureLine', () => {
  // The endpoint's own words are the diagnosis. A sentence written here can
  // introduce them; it cannot replace them.
  test('keeps what the server said', () => {
    expect(modelFailureLine(`HTTP 404: {"error":{"message":"model 'nope' not found"}}`)).toBe(
      `The model did not answer. HTTP 404: {"error":{"message":"model 'nope' not found"}}`,
    );
  });

  test('keeps the setting a truncation names', () => {
    const line = modelFailureLine('empty reply: used the whole 2048-token budget before answering — raise "Reply budget" in settings');
    expect(line).toContain('Reply budget');
  });

  test('a Notice is not a wall of text', () => {
    const line = modelFailureLine('x'.repeat(500));
    expect(line.length).toBeLessThan(200);
    expect(line.endsWith('…')).toBe(true);
  });

  test('a failure with nothing to say still says something', () => {
    expect(modelFailureLine('   ')).toBe('The model did not answer.');
  });
});
