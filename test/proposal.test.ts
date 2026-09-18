// The Proposal pathway through its own interface: pool, candidates, judgement,
// offer. Before 2026-09-16 this was four calls inside the Ask pane and no test
// could reach any of it.

import { describe, expect, test } from 'bun:test';
import type { Candidate, Model, Proposal } from '../src/model';
import { CANDIDATE_COUNT, proposalFor } from '../src/proposal';
import { parseRef } from '../src/refs';
import { fakeVault } from './fake-vault';

const ref = (s: string) => parseRef(s) as NonNullable<ReturnType<typeof parseRef>>;
const ANSWER_REF = ref('Sittings/2026-09-15#^a1');

/** A Model that records what it was shown and answers with whatever is set. */
function fakeModel(answer: Proposal | null): Model & { shown: Candidate[][] } {
  const shown: Candidate[][] = [];
  return {
    shown,
    available: true,
    reason: '',
    composeFollowUps: async () => [],
    composeRevisit: async () => [],
    proposeRelation: async (_a: string, candidates: Candidate[]) => {
      shown.push(candidates);
      return answer;
    },
  };
}

const OFF: Model = {
  available: false,
  reason: 'model switched off in settings',
  composeFollowUps: async () => [],
  composeRevisit: async () => [],
  proposeRelation: async () => null,
};

const BUFFALO = 'The buffaloes went past the auto stand in a slow procession that morning.';
const RIVER = 'The river was low and the buffaloes crossed it without breaking stride.';

const vault = () =>
  fakeVault({
    'Sittings/2026-09-15.md': `---\nabout: "[[me]]"\n---\n\n## Asked\n\nThe buffaloes still go past the auto stand. ^a1\n`,
    'Pieces/cities.md': `---\ntitle: Cities\nstatus: published\n---\n\n${BUFFALO} ^p-004\n`,
    'Pieces/rivers.md': `---\ntitle: Rivers\nstatus: published\n---\n\n${RIVER} ^p-009\n`,
    'Pieces/resume.md': [
      '---',
      'title: Resume',
      'status: page',
      '---',
      '',
      '## Bibliography',
      '',
      'Suchman, L. buffaloes auto stand procession morning. ^p-100',
      '',
      '## Project',
      '',
      'My Role: buffaloes auto stand procession ^p-101',
      '',
    ].join('\n'),
    'Bank/craft.md': '---\nkind: bank\n---\n\n- what did the buffaloes auto stand procession mean? ^b1\n',
  });

const ECHO: Proposal = { ref: 'Pieces/cities#^p-004', relation: 'echoes', quote: 'the buffaloes went' };

describe('the Proposal pathway', () => {
  test('an accepted judgement comes back with the candidate’s own words', async () => {
    const v = vault();
    const offer = await proposalFor(v.app, fakeModel(ECHO), 'Bank', 'the buffaloes and the auto stand', ANSWER_REF);
    expect(offer.kind).toBe('offer');
    if (offer.kind !== 'offer') return;
    expect(offer.proposal.relation).toBe('echoes');
    expect(offer.candidateText).toBe(BUFFALO);
  });

  test('an abstain is a reason, not an offer: abstain is always legal', async () => {
    const v = vault();
    const offer = await proposalFor(v.app, fakeModel(null), 'Bank', 'the buffaloes and the auto stand', ANSWER_REF);
    expect(offer).toEqual({ kind: 'none', reason: 'the model found no relation, or its quote did not check out' });
  });

  test('an answer sharing no words with the corpus never reaches the model', async () => {
    const v = vault();
    const model = fakeModel(ECHO);
    const offer = await proposalFor(v.app, model, 'Bank', 'Quixotic zeppelin fricassee.', ANSWER_REF);
    expect(offer).toEqual({ kind: 'none', reason: 'no earlier block shares words with this answer' });
    expect(model.shown).toHaveLength(0);
  });

  test('the model being off is its own reason, and costs no vault read', async () => {
    const v = vault();
    const offer = await proposalFor(v.app, OFF, 'Bank', 'the buffaloes and the auto stand', ANSWER_REF);
    expect(offer).toEqual({ kind: 'none', reason: 'model switched off in settings' });
  });
});

describe('what bonsai is shown', () => {
  const shownRefs = async (answer: string) => {
    const v = vault();
    const model = fakeModel(null);
    await proposalFor(v.app, model, 'Bank', answer, ANSWER_REF);
    return (model.shown[0] ?? []).map((c) => c.ref);
  };

  test('an answer is never shown its own block to relate to', async () => {
    const refs = await shownRefs('The buffaloes still go past the auto stand.');
    expect(refs).not.toContain('Sittings/2026-09-15#^a1');
    expect(refs).toContain('Pieces/cities#^p-004');
  });

  test('furniture is out of the pool: a bibliography seat and a field label never appear', async () => {
    const refs = await shownRefs('buffaloes auto stand procession morning');
    expect(refs).not.toContain('Pieces/resume#^p-100');
    expect(refs).not.toContain('Pieces/resume#^p-101');
  });

  test('the Bank is not the owner’s words, so it is not in the pool', async () => {
    const refs = await shownRefs('buffaloes auto stand procession');
    expect(refs).not.toContain('Bank/craft#^b1');
  });

  test('every block that survives is shown, up to the five slots', async () => {
    // One shared word, so the two blocks tie; the shorter text goes first.
    const refs = await shownRefs('buffaloes');
    expect(refs).toEqual(['Pieces/rivers#^p-009', 'Pieces/cities#^p-004']);
    expect(refs.length).toBeLessThanOrEqual(CANDIDATE_COUNT);
  });
});
