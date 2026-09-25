import { expect, test } from 'bun:test';
import { summaryLines } from '../src/graduate-modal';

// What the form shows under a title field once the summary job returns. It
// showed nothing at all when the model's reply was refused, which read as the
// feature not working. Now there is always a line.

test('the summary, when there is one', () => {
  expect(summaryLines({ questions: ['A river.', 'A house.'], error: null })).toEqual(['A river.', 'A house.']);
});

test('why there is none, when the call failed', () => {
  expect(summaryLines({ questions: [], error: 'timeout after 30000 ms' })).toEqual(['The model did not answer. timeout after 30000 ms']);
});

test('and a line of its own when the model gave nothing usable', () => {
  expect(summaryLines({ questions: [], error: null })).toEqual(['The model had nothing to say about this thread.']);
});
