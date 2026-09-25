import { describe, expect, test } from 'bun:test';
import { checkHeadings, checkSummary, suggestHeadings, summarizeThread } from '../src/bonsai';
import type { BonsaiConfig } from '../src/bonsai';

// The two model jobs graduation asks for. Neither writes anything: a summary
// is shown beside the title field, and a suggested heading is written only if
// the owner picks it. So the checks guard the SHAPE, and a failure costs the
// owner a suggestion, never a Piece.

const cfg = (replies: string[]): BonsaiConfig => {
  let i = 0;
  return {
    baseUrl: 'http://fake',
    model: 'fake',
    fetcher: async () => ({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: replies[Math.min(i++, replies.length - 1)] } }] }),
    }),
  };
};

const SECTIONS = [
  { question: 'why the river?', answer: 'Because it keeps moving, and I do not.' },
  { question: 'what moves you, then?', answer: 'People who stay.' },
];

describe('the summary', () => {
  test('up to three lines', () => {
    expect(checkSummary({ lines: ['A river that moves.', 'Someone who does not.'] })).toEqual({ kind: 'ok', value: ['A river that moves.', 'Someone who does not.'] });
    expect(checkSummary({ lines: [] }).kind).toBe('invalid');
    expect(checkSummary({ lines: ['', '  '] }).kind).toBe('invalid');
  });

  // The summary is shown and thrown away, so a reply that runs long is cut to
  // size rather than refused. Refusing cost the owner the whole summary: a
  // thread with follow-ups draws longer lines, the check refused both
  // attempts, and the form showed nothing and said nothing.
  test('a long reply is kept, cut to three lines', () => {
    const long = 'Praying to a voice in the sky when my situation feels helpless and nothing else will answer me at all';
    expect(checkSummary({ lines: [long, 'two', 'three', 'four'] })).toEqual({ kind: 'ok', value: [long, 'two', 'three'] });
  });

  test('reads the sections and comes back as lines', async () => {
    expect(await summarizeThread(cfg(['{"lines":["The river moves; they stay."]}']), SECTIONS)).toEqual(['The river moves; they stay.']);
  });
});

describe('the headings', () => {
  test('one per section, short, on one line', () => {
    expect(checkHeadings({ headings: ['The river', 'Who stays'] }, 2)).toEqual({ kind: 'ok', value: ['The river', 'Who stays'] });
    expect(checkHeadings({ headings: ['The river'] }, 2).kind).toBe('invalid');
    expect(checkHeadings({ headings: ['The river', 'Who\nstays'] }, 2).kind).toBe('invalid');
    expect(checkHeadings({ headings: ['The river', ''] }, 2).kind).toBe('invalid');
  });

  test('a markdown heading marker the model adds is taken off', () => {
    expect(checkHeadings({ headings: ['## The river', '# Who stays'] }, 2)).toEqual({ kind: 'ok', value: ['The river', 'Who stays'] });
  });

  test('a wrong count is retried once, then nothing', async () => {
    expect(await suggestHeadings(cfg(['{"headings":["one"]}', '{"headings":["The river","Who stays"]}']), SECTIONS)).toEqual(['The river', 'Who stays']);
    expect(await suggestHeadings(cfg(['{"headings":["one"]}']), SECTIONS)).toEqual([]);
  });
});
