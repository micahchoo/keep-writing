import { describe, expect, test } from 'bun:test';
import { checkFollowUps, checkProposal, checkRevisit, composeFollowUps, composeRevisit, extractJson, isParrot, locateQuote, splitDue } from '../src/bonsai';
import type { Candidate } from '../src/bonsai';
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
      [], // nothing asked yet: this test is about the other rules
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
    const v = checkFollowUps({ questions: ['Tell me more.'] }, ANSWER, []);
    expect(v.kind).toBe('invalid');
  });
  test('invalid shape', () => {
    expect(checkFollowUps({ question: 'x?' }, ANSWER, []).kind).toBe('invalid');
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
    const out = await composeFollowUps(cfg(['{"questions":["What happened the first time?","Tell me more."]}']), 'q?', ANSWER, [], 'me');
    expect(out).toEqual(['What happened the first time?']);
  });
  test('retries once, then gives up empty', async () => {
    const out = await composeFollowUps(cfg(['{"questions":["Tell me more."]}', '{"questions":["Still no."]}']), 'q?', ANSWER, [], 'me');
    expect(out).toEqual([]);
  });
  test('abstain is empty without retry', async () => {
    let calls = 0;
    const c = cfg(['{"abstain":true}']);
    const f = c.fetcher;
    c.fetcher = (u, i) => { calls++; return f(u, i); };
    expect(await composeFollowUps(c, 'q?', ANSWER, [], 'me')).toEqual([]);
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
    const out = await composeRevisit(cfg, PARAGRAPH, 'in 2021, for Branch Magazine', []);
    expect(out).toEqual([{ question: 'What did the buffaloes see that you left out?' }]);
    const sent = JSON.parse(bodies[0] as string) as { messages: { role: string; content: string }[] };
    expect(sent.messages[1]?.content).toBe(`Something they wrote in 2021, for Branch Magazine:\n\n${PARAGRAPH}`);
    expect(log.map((e) => e.job)).toEqual(['revisit']);
    expect(log[0]?.outcome).toBe('ok');
  });

  test('without a Lens the system prompt is the interviewer alone; with one, the Lens is appended verbatim', async () => {
    const reply = '{"questions":["What did the buffaloes see that you left out?"]}';
    const plain = capture([reply]);
    await composeRevisit(plain.cfg, PARAGRAPH, 'in 2021', []);
    const lensed = capture([reply]);
    const LENS = 'Look for what happened, in order, before you look for what it means.\n\n1. A moment named.';
    await composeRevisit(lensed.cfg, PARAGRAPH, 'in 2021', [], LENS);
    const system = (bodies: string[]) => (JSON.parse(bodies[0] as string) as { messages: { content: string }[] }).messages[0]?.content ?? '';
    expect(system(plain.bodies)).not.toContain('Look for what happened');
    expect(system(lensed.bodies)).toBe(`${system(plain.bodies)}\n\n${LENS}`);
    expect(system(lensed.bodies).endsWith(LENS)).toBe(true);
  });

  test('a trailing (due +7d) marker is stripped from the question and returned as dueDays', async () => {
    const { cfg } = capture([
      '{"questions":["Go read one page of Reve tonight; what surprised you? (due +7d)","Which word did you look up first? (due +3d)?","What does the first sentence mean?"]}',
    ]);
    const out = await composeRevisit(cfg, PARAGRAPH, 'in what they wrote about wanting to learn Dutch', [], 'reach for a rung');
    expect(out).toEqual([
      { question: 'Go read one page of Reve tonight; what surprised you?', dueDays: 7 },
      { question: 'Which word did you look up first?', dueDays: 3 },
      { question: 'What does the first sentence mean?' },
    ]);
  });

  test('empty after the retry also fails, so the pane falls back', async () => {
    const { cfg, log } = capture(['{"questions":["Tell me more."]}', 'no json here']);
    expect(await composeRevisit(cfg, PARAGRAPH, 'in 2020, in a draft they set down', [])).toEqual([]);
    expect(log.length).toBe(2);
  });
});

describe('a follow-up never re-asks the question that was just answered', () => {
  const asked = 'What is one specific area where you feel the pressure to evolve is most intense right now?';
  const answer = '1. Dating - making friends is much harder now\n2. Going out - I have to drive long distances\n3. Finding reasons to stay healthy';

  test('the same question back is dropped, whatever the answer looked like', () => {
    const v = checkFollowUps({ questions: [asked] }, answer, [asked]);
    expect(v.kind).toBe('invalid');
    if (v.kind === 'invalid') expect(v.reason).toContain('re-asks');
  });

  test('so is a re-ask built only from the words of the question', () => {
    const trimmed = 'What is one specific area where the pressure to evolve is most intense?';
    expect(checkFollowUps({ questions: [trimmed] }, answer, [asked]).kind).toBe('invalid');
  });

  test('the check reaches exactly as far as isParrot: one new content word passes it', () => {
    // Not an aspiration, a boundary. What was measured is the verbatim echo;
    // a re-ask that brings a word of its own is left to the model's prompt.
    const reworded = 'Which specific area right now do you feel the pressure to evolve most intense?';
    expect(checkFollowUps({ questions: [reworded] }, answer, [asked]).kind).toBe('ok');
  });

  test('a question that opens one of the three is kept', () => {
    const fresh = 'What made it easier to date friends than to date strangers?';
    const v = checkFollowUps({ questions: [asked, fresh] }, answer, [asked]);
    expect(v.kind).toBe('ok');
    if (v.kind === 'ok') expect(v.value).toEqual([fresh]);
  });

  test('the set is what the check runs on: empty lets the re-ask through', () => {
    // This is the defect the set exists to close. Until 2026-09-16 the Revisit
    // path had no set at all, so it ran exactly like this, always.
    expect(checkFollowUps({ questions: [asked] }, answer, []).kind).toBe('ok');
  });

  test('every question in the set is checked, not just the first', () => {
    const earlier = 'What makes repetition of our conditions hopeless or energizing?';
    const v = checkFollowUps({ questions: [earlier] }, answer, [asked, earlier]);
    expect(v.kind).toBe('invalid');
    if (v.kind === 'invalid') expect(v.reason).toContain(earlier);
  });
});

// ---------------------------------------------------------------------------
// The Proposal's half of "bonsai judges, code arbitrates" (CONTEXT.md). These
// four functions are the whole distance between a model's output and a typed
// Link written into the vault on both ends, and until 2026-09-16 no test
// imported any of them.

describe('extractJson', () => {
  test('a bare object', () => {
    expect(extractJson('{"relation":"echoes"}')).toEqual({ relation: 'echoes' });
  });
  test('inside a code fence, labelled or not', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  test('with prose either side of it', () => {
    expect(extractJson('Sure! {"a":1} hope that helps.')).toEqual({ a: 1 });
  });
  test('the first BALANCED object, so a nested one comes back whole', () => {
    expect(extractJson('{"a":{"b":2},"c":3}')).toEqual({ a: { b: 2 }, c: 3 });
  });
  test('a closing brace inside a string does not end the object', () => {
    expect(extractJson('{"quote":"a } brace, mid-sentence"}')).toEqual({ quote: 'a } brace, mid-sentence' });
  });
  test('an escaped quote inside a string does not end the string', () => {
    expect(extractJson('{"quote":"she said \\"no\\" and left"}')).toEqual({ quote: 'she said "no" and left' });
  });
  test('no object at all, and an object that will not parse, are both null', () => {
    expect(extractJson('I would rather not.')).toBeNull();
    expect(extractJson('{"a": }')).toBeNull();
  });
});

describe('locateQuote', () => {
  const TEXT = 'I weighted the pelvis bone wrong in every rig I made that year.';

  test('an exact substring is itself', () => {
    expect(locateQuote('the pelvis bone', TEXT)).toBe('the pelvis bone');
  });
  test('words that are not there are null', () => {
    expect(locateQuote('the femur', TEXT)).toBeNull();
  });
  test('a case change still fails: nothing but quote marks is normalized', () => {
    expect(locateQuote('The Pelvis Bone', TEXT)).toBeNull();
  });

  // Measured 2026-09-13: bonsai swaps a phrase's inner double quotes for
  // single ones when it writes JSON, and repeats the swap under the retry.
  const SPOKEN = 'he called it "the hips" for years afterwards';

  test('a swapped quote mark matches, and what comes back is the TEXT’s own characters', () => {
    expect(locateQuote("he called it 'the hips'", SPOKEN)).toBe('he called it "the hips"');
  });
  test('regex metacharacters inside a swapped quote are escaped, not interpreted', () => {
    const text = 'the invoice said "it cost $5 (roughly)" and nobody checked';
    expect(locateQuote("the invoice said 'it cost $5 (roughly)'", text)).toBe('the invoice said "it cost $5 (roughly)"');
    expect(locateQuote("the invoice said 'it cost .. (roughly)'", text)).toBeNull();
  });
});

describe('checkProposal', () => {
  const CANDIDATES: Candidate[] = [
    { ref: 'Pieces/cities#^p-004', text: 'The pelvis bone was weighted wrong in every rig I made that year.' },
    { ref: 'Sittings/2026-09-14#^y1', text: 'I only ever called it "the hips" because the rig sheet did.' },
  ];

  test('a ref, a relation and a quote that check out', () => {
    expect(checkProposal({ ref: 'Pieces/cities#^p-004', relation: 'echoes', quote: 'weighted wrong in every rig' }, CANDIDATES))
      .toEqual({ kind: 'ok', value: { ref: 'Pieces/cities#^p-004', relation: 'echoes', quote: 'weighted wrong in every rig' } });
  });

  test('the relation is trimmed and lower-cased', () => {
    const v = checkProposal({ ref: 'Pieces/cities#^p-004', relation: '  Follows ', quote: 'weighted wrong in every rig' }, CANDIDATES);
    expect(v).toMatchObject({ kind: 'ok', value: { relation: 'follows' } });
  });

  test('a ref the model invented is refused', () => {
    const v = checkProposal({ ref: 'Pieces/never-written#^p-001', relation: 'echoes', quote: 'weighted wrong in every rig' }, CANDIDATES);
    expect(v).toMatchObject({ kind: 'invalid' });
    expect((v as { reason: string }).reason).toContain('not one of the candidate refs');
  });

  // `demonstrates` is a real relation in links.ts and NOT one bonsai may name:
  // a Skill cites performance, which is the owner's claim to make, not a model's.
  test('a relation outside the three is refused, even one the Link table knows', () => {
    const v = checkProposal({ ref: 'Pieces/cities#^p-004', relation: 'demonstrates', quote: 'weighted wrong in every rig' }, CANDIDATES);
    expect(v).toMatchObject({ kind: 'invalid' });
    expect((v as { reason: string }).reason).toContain('is not one of echoes, contradicts, follows');
  });

  test('a quote that is not in the block is refused', () => {
    const v = checkProposal({ ref: 'Pieces/cities#^p-004', relation: 'echoes', quote: 'the femur was fine' }, CANDIDATES);
    expect(v).toMatchObject({ kind: 'invalid' });
    expect((v as { reason: string }).reason).toContain('is not an exact substring');
  });

  test('a quote under three words is refused: two words show no relation', () => {
    const v = checkProposal({ ref: 'Pieces/cities#^p-004', relation: 'echoes', quote: 'The pelvis' }, CANDIDATES);
    expect(v).toMatchObject({ kind: 'invalid' });
    expect((v as { reason: string }).reason).toContain('fewer than 3 words');
  });

  test('a missing field is named', () => {
    expect(checkProposal({}, CANDIDATES)).toEqual({ kind: 'invalid', reason: 'missing "ref"' });
    expect(checkProposal({ ref: 'Pieces/cities#^p-004' }, CANDIDATES)).toEqual({ kind: 'invalid', reason: 'missing "relation"' });
    expect(checkProposal({ ref: 'Pieces/cities#^p-004', relation: 'echoes', quote: '  ' }, CANDIDATES))
      .toEqual({ kind: 'invalid', reason: 'missing "quote"' });
  });

  test('output that is not an object at all', () => {
    expect(checkProposal(null, CANDIDATES)).toEqual({ kind: 'invalid', reason: 'output is not an object' });
  });

  // The Link carries the owner's characters, never the model's re-spelling.
  test('a swapped quote mark passes, and the block’s own spelling is what is kept', () => {
    const v = checkProposal(
      { ref: 'Sittings/2026-09-14#^y1', relation: 'follows', quote: "called it 'the hips' because" },
      CANDIDATES,
    );
    expect(v).toEqual({
      kind: 'ok',
      value: { ref: 'Sittings/2026-09-14#^y1', relation: 'follows', quote: 'called it "the hips" because' },
    });
  });
});

describe('checkRevisit', () => {
  const PARAGRAPH = 'The map only aligned after I georeferenced it against the survey sheet.';

  test('the due marker comes off before the checks and back on the kept question', () => {
    expect(checkRevisit({ questions: ['which bone did you weight it to (due +3d)?'] }, PARAGRAPH, [])).toEqual({
      kind: 'ok',
      value: [{ question: 'which bone did you weight it to?', dueDays: 3 }],
    });
  });

  test('the asked set reaches a candidate carrying a due marker', () => {
    expect(
      checkRevisit(
        { questions: ['what broke in the rig?', 'which bone did you weight it to (due +3d)?'] },
        PARAGRAPH,
        ['what broke in the rig?'],
      ),
    ).toEqual({ kind: 'ok', value: [{ question: 'which bone did you weight it to?', dueDays: 3 }] });
  });

  test('nothing survives the asked set, so the whole output is invalid and the pane falls back', () => {
    expect(checkRevisit({ questions: ['what broke in the rig?'] }, PARAGRAPH, ['what broke in the rig?']))
      .toMatchObject({ kind: 'invalid' });
  });

  test('a missing questions array is named', () => {
    expect(checkRevisit({ answer: 'no' }, PARAGRAPH, [])).toEqual({ kind: 'invalid', reason: 'missing "questions" array' });
  });

  // The candidate goes through the checks whole, so its due date is never
  // matched back up to it by text afterwards. Two candidates that read the
  // same are one question, and it keeps the first date offered.
  test('two candidates that read the same are one, and it keeps the first date', () => {
    expect(
      checkRevisit({ questions: ['explain it back to me? (due +3d)', 'explain it back to me? (due +7d)'] }, PARAGRAPH, []),
    ).toEqual({ kind: 'ok', value: [{ question: 'explain it back to me?', dueDays: 3 }] });
  });
});
