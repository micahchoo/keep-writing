// The Proposal pathway, whole: take a fresh answer, find the blocks it might
// relate to, let bonsai judge, and hand back one offer or the reason there is
// none. See CONTEXT.md, "Proposal".
//
// Code arbitrates, bonsai judges, and the split is here: code decides which
// blocks are eligible (pool.ts), which five it shows (lexical.ts) and that the
// answer is not shown its own block; bonsai decides whether any of them is
// related, and may abstain.
//
// This used to be four calls in the pane, which had to hold three facts to
// make them: how to build the pool, that the number is five, and that the
// answer's own ref must be excluded. None of those is the pane's business.

import type { App } from 'obsidian';
import { findCandidates } from './lexical';
import type { Model, Proposal } from './model';
import { blockPool } from './pool';
import { formatRef } from './refs';
import type { Ref } from './refs';

/**
 * How many blocks bonsai is shown at once. Five distinct texts: a second
 * Telling of the same paragraph takes no slot of its own, because showing the
 * same words twice spends a slot and teaches nothing (lexical.ts).
 */
export const CANDIDATE_COUNT = 5;

/** One Proposal to show, or why there is none. Both are things the pane says. */
export type ProposalOffer =
  | { kind: 'offer'; proposal: Proposal; candidateText: string }
  | { kind: 'none'; reason: string };

const NOTHING_SHARED = 'no earlier block shares words with this answer';
const NO_RELATION = 'the model found no relation, or its quote did not check out';

/**
 * Propose a relation between `answer` and one earlier block of the owner's.
 * `answerRef` is the answer's own block, which is never a candidate for
 * relating to itself. Never throws: every way this can come to nothing is a
 * `none` with a reason to show.
 */
export async function proposalFor(
  app: App,
  model: Model,
  bankFolder: string,
  answer: string,
  answerRef: Ref,
): Promise<ProposalOffer> {
  if (!model.available) return { kind: 'none', reason: model.reason };

  const pool = await blockPool(app, bankFolder);
  const candidates = findCandidates(answer, pool, CANDIDATE_COUNT, formatRef(answerRef));
  if (candidates.length === 0) return { kind: 'none', reason: NOTHING_SHARED };

  const proposal = await model.proposeRelation(answer, candidates);
  if (!proposal) return { kind: 'none', reason: NO_RELATION };

  // checkProposal has already refused any ref that is not one of these, so the
  // text is always found; the fallback is for a shape that cannot occur.
  const candidateText = candidates.find((c) => c.ref === proposal.ref)?.text ?? '';
  return { kind: 'offer', proposal, candidateText };
}
