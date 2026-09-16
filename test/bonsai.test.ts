import { describe, expect, test } from 'bun:test';
import { checkFollowUps, composeFollowUps, composeRevisit, isParrot, splitDue } from '../src/bonsai';
import type { CallLog } from '../src/bonsai';
import type { BonsaiConfig } from '../src/bonsai';

const ANSWER = 'Transition Design - if it is in the service of understanding the historical setting we should introduce new ideas where the transitions exist.';

describe('checkFollowUps', () => {
  test('keeps good candidates in order, drops the bad ones', () => {
    const v = checkFollowUps(
      {
        questions: [
          'What would the opposite of a transition look like?',
          'You said transitions exist; where?',
          'Should we introduce new ideas where the transitions exist in the historical setting?',
          'Tell me more.',
          'When did a transition first feel like a door rather than a gap?',
          'What would the opposite of a transition look like?',
        ],
      },
      ANSWER,
    );
    expect(v.kind).toBe('ok');
    if (v.kind === 'ok') {
      expect(v.value).toEqual([
        'What would the opposite of a transition look like?',
        'When did a transition first feel like a door rather than a gap?',
      ]);
    }
  });
  test('invalid when nothing survives', () => {
    const v = checkFollowUps({ questions: ['Tell me more.'] }, ANSWER);
    expect(v.kind).toBe('invalid');
  });
  test('invalid shape', () => {
    expect(checkFollowUps({ question: 'x?' }, ANSWER).kind).toBe('invalid');
  });
});

describe('isParrot', () => {
  test('the answer with a question mark is a parrot', () => {
    expect(isParrot('Should we introduce new ideas where the transitions exist in the historical setting?', ANSWER)).toBe(true);
  });
  test('a fresh question is not', () => {
    expect(isParrot('What did the first transition you noticed look like?', ANSWER)).toBe(false);
  });
});

describe('composeFollowUps with a fake server', () => {
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
  test('returns the kept questions', async () => {
    const out = await composeFollowUps(cfg(['{"questions":["What happened the first time?","Tell me more."]}']), 'q?', ANSWER, 'me');
    expect(out).toEqual(['What happened the first time?']);
  });
  test('retries once, then gives up empty', async () => {
    const out = await composeFollowUps(cfg(['{"questions":["Tell me more."]}', '{"questions":["Still no."]}']), 'q?', ANSWER, 'me');
    expect(out).toEqual([]);
  });
  test('abstain is empty without retry', async () => {
    let calls = 0;
    const c = cfg(['{"abstain":true}']);
    const f = c.fetcher;
    c.fetcher = (u, i) => { calls++; return f(u, i); };
    expect(await composeFollowUps(c, 'q?', ANSWER, 'me')).toEqual([]);
    expect(calls).toBe(1);
  });
});

describe('splitDue', () => {
  test('no marker: the question, trimmed', () => {
    expect(splitDue('  What happened?  ')).toEqual({ question: 'What happened?' });
  });
  test('marker after the question mark', () => {
    expect(splitDue('What surprised you? (due +7d)')).toEqual({ question: 'What surprised you?', dueDays: 7 });
  });
  test('marker before a closing question mark keeps the mark on the question', () => {
    expect(splitDue('What surprised you (due +14d)?')).toEqual({ question: 'What surprised you?', dueDays: 14 });
  });
  test('a marker not at the end is left alone', () => {
    expect(splitDue('(due +7d) what?')).toEqual({ question: '(due +7d) what?' });
  });
});

describe('composeRevisit with a fake server', () => {
  const PARAGRAPH =
    'The buffaloes on the Koramangala road did not look up when the trucks passed. I wrote that down and never used it.';
  const capture = (replies: string[]) => {
    let i = 0;
    const bodies: string[] = [];
    const log: CallLog[] = [];
    const cfg: BonsaiConfig = {
      baseUrl: 'http://fake',
      model: 'fake',
      onLog: (e) => log.push(e),
      fetcher: async (_url, init) => {
        bodies.push(init.body);
        return {
          status: 200,
          text: JSON.stringify({ choices: [{ message: { content: replies[Math.min(i++, replies.length - 1)] } }] }),
        };
      },
    };
    return { cfg, bodies, log };
  };

  test('frames the paragraph, keeps fresh questions, logs the job as revisit', async () => {
    const { cfg, bodies, log } = capture([
      '{"questions":["What did the buffaloes see that you left out?","You wrote that down; why?","Tell me more."]}',
    ]);
    const out = await composeRevisit(cfg, PARAGRAPH, 'in 2021, for Branch Magazine');
    expect(out).toEqual([{ question: 'What did the buffaloes see that you left out?' }]);
    const sent = JSON.parse(bodies[0] as string) as { messages: { role: string; content: string }[] };
    expect(sent.messages[1]?.content).toBe(`Something they wrote in 2021, for Branch Magazine:\n\n${PARAGRAPH}`);
    expect(log.map((e) => e.job)).toEqual(['revisit']);
    expect(log[0]?.outcome).toBe('ok');
  });

  test('without a Lens the system prompt is the interviewer alone; with one, the Lens is appended verbatim', async () => {
    const reply = '{"questions":["What did the buffaloes see that you left out?"]}';
    const plain = capture([reply]);
    await composeRevisit(plain.cfg, PARAGRAPH, 'in 2021');
    const lensed = capture([reply]);
    const LENS = 'Look for what happened, in order, before you look for what it means.\n\n1. A moment named.';
    await composeRevisit(lensed.cfg, PARAGRAPH, 'in 2021', LENS);
    const system = (bodies: string[]) => (JSON.parse(bodies[0] as string) as { messages: { content: string }[] }).messages[0]?.content ?? '';
    expect(system(plain.bodies)).not.toContain('Look for what happened');
    expect(system(lensed.bodies)).toBe(`${system(plain.bodies)}\n\n${LENS}`);
    expect(system(lensed.bodies).endsWith(LENS)).toBe(true);
  });

  test('a trailing (due +7d) marker is stripped from the question and returned as dueDays', async () => {
    const { cfg } = capture([
      '{"questions":["Go read one page of Reve tonight; what surprised you? (due +7d)","Which word did you look up first? (due +3d)?","What does the first sentence mean?"]}',
    ]);
    const out = await composeRevisit(cfg, PARAGRAPH, 'in what they wrote about wanting to learn Dutch', 'reach for a rung');
    expect(out).toEqual([
      { question: 'Go read one page of Reve tonight; what surprised you?', dueDays: 7 },
      { question: 'Which word did you look up first?', dueDays: 3 },
      { question: 'What does the first sentence mean?' },
    ]);
  });

  test('empty after the retry also fails, so the pane falls back', async () => {
    const { cfg, log } = capture(['{"questions":["Tell me more."]}', 'no json here']);
    expect(await composeRevisit(cfg, PARAGRAPH, 'in 2020, in a draft they set down')).toEqual([]);
    expect(log.length).toBe(2);
  });
});

describe('a follow-up never re-asks the question that was just answered', () => {
  const asked = 'What is one specific area where you feel the pressure to evolve is most intense right now?';
  const answer = '1. Dating - making friends is much harder now\n2. Going out - I have to drive long distances\n3. Finding reasons to stay healthy';

  test('the same question back is dropped, whatever the answer looked like', () => {
    const v = checkFollowUps({ questions: [asked] }, answer, asked);
    expect(v.kind).toBe('invalid');
    if (v.kind === 'invalid') expect(v.reason).toContain('re-asks the question');
  });

  test('so is a re-ask built only from the words of the question', () => {
    const trimmed = 'What is one specific area where the pressure to evolve is most intense?';
    expect(checkFollowUps({ questions: [trimmed] }, answer, asked).kind).toBe('invalid');
  });

  test('the check reaches exactly as far as isParrot: one new content word passes it', () => {
    // Not an aspiration, a boundary. What was measured is the verbatim echo;
    // a re-ask that brings a word of its own is left to the model's prompt.
    const reworded = 'Which specific area right now do you feel the pressure to evolve most intense?';
    expect(checkFollowUps({ questions: [reworded] }, answer, asked).kind).toBe('ok');
  });

  test('a question that opens one of the three is kept', () => {
    const fresh = 'What made it easier to date friends than to date strangers?';
    const v = checkFollowUps({ questions: [asked, fresh] }, answer, asked);
    expect(v.kind).toBe('ok');
    if (v.kind === 'ok') expect(v.value).toEqual([fresh]);
  });

  test('with no asked question — a Revisit — the check does not run', () => {
    expect(checkFollowUps({ questions: [asked] }, answer).kind).toBe('ok');
  });
});
