// The model seam. Everything that needs bonsai (Follow-ups, Revisits,
// Proposals) goes through a `Model`. Wired to src/bonsai.ts; when the model is
// switched off in settings the seam reports "not available" and returns
// nothing, so every caller degrades to the bank-only behaviour.
//
// Only jobs bonsai does live here. Finding the candidate blocks is code's own
// work (lexical.ts), and it sat on this seam as a re-export until 2026-09-16 —
// a pass-through that made callers think the model was choosing.

import { requestUrl } from 'obsidian';
import { composeFollowUps, composeRevisit, proposeRelation } from './bonsai';
import type { BonsaiConfig, CallLog, Candidate, Proposal, Relation, RevisitCandidate } from './bonsai';
import type { KeepWritingSettings } from './settings';

export type { CallLog, Candidate, Proposal, Relation, RevisitCandidate };

export interface Model {
  /** False when the model is switched off in settings. */
  readonly available: boolean;
  /** Why it is unavailable, for the pane. Empty when available. */
  readonly reason: string;
  /** Up to three follow-up questions, best first; empty when none. `asked` is every other question already put in this Sitting. */
  composeFollowUps(question: string, answer: string, asked: string[], target: string): Promise<string[]>;
  /** Up to three questions about a paragraph the owner wrote before, through the Well's Lens; empty when none. `asked` is what was already asked from that block. */
  composeRevisit(paragraph: string, framing: string, asked: string[], lens: string): Promise<RevisitCandidate[]>;
  /** Judge whether the answer relates to one of these blocks. Null is a legal abstain. */
  proposeRelation(answer: string, candidates: Candidate[]): Promise<Proposal | null>;
}

/** Obsidian's requestUrl, in the fetch-like shape bonsai.ts expects. */
const fetcher: BonsaiConfig['fetcher'] = async (url, init) => {
  const res = await requestUrl({ url, method: init.method, headers: init.headers, body: init.body, throw: false });
  return { status: res.status, text: res.text };
};

export function createModel(settings: KeepWritingSettings, onLog?: (entry: CallLog) => void): Model {
  if (!settings.enableModel) {
    return {
      available: false,
      reason: 'model switched off in settings',
      composeFollowUps: async () => [],
      composeRevisit: async () => [],
      proposeRelation: async () => null,
    };
  }
  const cfg: BonsaiConfig = { baseUrl: settings.baseUrl, model: settings.model, fetcher };
  if (onLog) cfg.onLog = onLog;
  return {
    available: true,
    reason: '',
    composeFollowUps: (question, answer, asked, target) => composeFollowUps(cfg, question, answer, asked, target),
    composeRevisit: (paragraph, framing, asked, lens) => composeRevisit(cfg, paragraph, framing, asked, lens),
    proposeRelation: (answer, candidates) => proposeRelation(cfg, answer, candidates),
  };
}
