import { describe, expect, test } from 'bun:test';
import { threadSections, threadsOf } from '../src/threads';

// A Thread is a root Ask and every Follow-up that grew from it. The `from`
// line already says which is which: a Follow-up cites an answer block in the
// same Sitting, and anything else — a Bank draw, the Seed, a Revisit, a
// Selection, the Pick-up — starts a new thread. So the grouping is read, never
// judged: no model, and no owner sorting answers by hand.

const SITTING = [
  '## Asked',
  '',
  '> [!ask] what are you saving up for?',
  '> from [[Bank/q#^b1]]',
  '',
  'A house by the river. ^a1',
  '',
  '> [!ask] how can you be more open?',
  '> from [[Bank/q#^b2]]',
  '',
  'I said yes to the dinner. ^a2',
  '',
  '> [!ask] why the river?',
  '> from [[Sittings/2026-09-15#^a1]]',
  '',
  'Because it keeps moving. ^a3',
  '',
  'And I do not.',
  '',
  '> [!ask] what moves you, then?',
  '> from [[Sittings/2026-09-15#^a3]]',
  '',
  'People who stay. ^a4',
  '',
  '> [!ask] what did you never finish?',
  '> from [[Bank/q#^b3]]',
  '',
  '## Closing',
  '',
  '> [!ask] where should we pick up?',
  '> from [[Bank/closing#^x-005]]',
  '',
  'The river, again. ^a5',
  '',
].join('\n');

const here = (path: string) => path === 'Sittings/2026-09-15';
const bookmark = (ref: string) => ref === 'Bank/closing#^x-005';

describe('threads', () => {
  test('a Follow-up joins the thread of the answer it cites, however deep the chain', () => {
    const threads = threadsOf(SITTING, here, bookmark);
    expect(threads.map((t) => t.asks.map((a) => a.question))).toEqual([
      ['what are you saving up for?', 'why the river?', 'what moves you, then?'],
      ['how can you be more open?'],
    ]);
  });

  test('a thread keeps its sections in the order the note holds them, though another thread sits between', () => {
    const [river] = threadsOf(SITTING, here, bookmark);
    expect(river!.asks.map((a) => a.callout.start)).toEqual([2, 12, 19]);
  });

  test('the Bookmark is no thread, and neither is a question nobody answered', () => {
    const roots = threadsOf(SITTING, here, bookmark).map((t) => t.asks[0]!.question);
    expect(roots).not.toContain('where should we pick up?');
    expect(roots).not.toContain('what did you never finish?');
  });

  test('a link into ANOTHER Sitting starts a thread: the Pick-up is a new draw', () => {
    const pickUp = SITTING.replace('[[Sittings/2026-09-15#^a1]]', '[[Sittings/2026-09-14#^a1]]');
    const threads = threadsOf(pickUp, here, bookmark);
    expect(threads.map((t) => t.asks[0]!.question)).toEqual([
      'what are you saving up for?',
      'how can you be more open?',
      'why the river?',
    ]);
  });

  test('a section is the question and every line the owner wrote under it, verbatim', () => {
    const [river] = threadsOf(SITTING, here, bookmark);
    expect(threadSections(SITTING, river!)[1]).toEqual({
      question: 'why the river?',
      answer: 'Because it keeps moving. ^a3\n\nAnd I do not.',
    });
  });
});
