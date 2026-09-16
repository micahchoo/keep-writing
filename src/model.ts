// The model seam. Everything that needs bonsai (Follow-ups, Revisits, Proposals) goes
// through a `Model`. Wired to src/bonsai.ts and src/lexical.ts; when the
// model is switched off in settings the seam reports "not available" and
// returns null, so every caller degrades to the bank-only behaviour.

import { requestUrl } from 'obsidian';
import { composeFollowUps, composeRevisit, proposeRelation } from './bonsai';
import type { BonsaiConfig, CallLog, Candidate, Proposal, Relation, RevisitCandidate } from './bonsai';
import { findCandidates } from './lexical';
import type { Block } from './lexical';
import type { KeepWritingSettings } from './settings';

export type { Block, CallLog, Candidate, Proposal, Relation, RevisitCandidate };

export interface Model {
  /** False when the model is switched off in settings. */
  readonly available: boolean;
  /** Why it is unavailable, for the pane. Empty when available. */
  readonly reason: string;
  /** Up to three follow-up questions, best first; empty when none. */
  composeFollowUps(question: string, answer: string, target: string): Promise<string[]>;
  /** Up to three questions about a paragraph the owner wrote before, through the Well's Lens; empty when none. */
  composeRevisit(paragraph: string, framing: string, lens: string): Promise<RevisitCandidate[]>;
  findCandidates(answer: string, pool: Block[], k: number, excludeRef?: string): Block[];
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
      findCandidates: () => [],
      proposeRelation: async () => null,
    };
  }
  const cfg: BonsaiConfig = { baseUrl: settings.baseUrl, model: settings.model, fetcher };
  if (onLog) cfg.onLog = onLog;
  return {
    available: true,
    reason: '',
    composeFollowUps: (question, answer, target) => composeFollowUps(cfg, question, answer, target),
    composeRevisit: (paragraph, framing, lens) => composeRevisit(cfg, paragraph, framing, lens),
    findCandidates,
    proposeRelation: (answer, candidates) => proposeRelation(cfg, answer, candidates),
  };
}
