// The model seam. Everything that needs bonsai (Follow-ups, Revisits) goes
// through a `Model`. Wired to src/bonsai.ts; when the model is
// switched off in settings the seam reports "not available" and returns
// nothing, so every caller degrades to the bank-only behaviour.
//
// Only jobs bonsai does live here. A third one, proposeRelation, was taken out
// on 2026-09-17: it read every answer against five lexically-near blocks and
// had produced one link in the vault's life.

import { requestUrl } from 'obsidian';
import { composeFollowUps, composeInvitation, composeRevisit } from './bonsai';
import type { BonsaiConfig, CallLog, RevisitCandidate } from './bonsai';
import type { KeepWritingSettings } from './settings';

export type { CallLog, RevisitCandidate };

export interface Model {
  /** False when the model is switched off in settings. */
  readonly available: boolean;
  /** Why it is unavailable, for the pane. Empty when available. */
  readonly reason: string;
  /** Up to three follow-up questions, best first; empty when none. `asked` is every other question already put in this Sitting. */
  composeFollowUps(question: string, answer: string, asked: string[], target: string): Promise<string[]>;
  /** Up to three questions ABOUT a paragraph the owner pointed at; empty when none. `asked` is what was already asked from that block. */
  composeRevisit(paragraph: string, framing: string, asked: string[], lens: string): Promise<RevisitCandidate[]>;
  /** Up to three invitations SEEDED by a paragraph the draw found, aimed at the owner's present. No framing: see INVITATION_SYSTEM. */
  composeInvitation(paragraph: string, asked: string[], lens: string): Promise<RevisitCandidate[]>;
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
      composeInvitation: async () => [],
    };
  }
  const cfg: BonsaiConfig = { baseUrl: settings.baseUrl, model: settings.model, fetcher };
  if (onLog) cfg.onLog = onLog;
  return {
    available: true,
    reason: '',
    composeFollowUps: (question, answer, asked, target) => composeFollowUps(cfg, question, answer, asked, target),
    composeRevisit: (paragraph, framing, asked, lens) => composeRevisit(cfg, paragraph, framing, asked, lens),
    composeInvitation: (paragraph, asked, lens) => composeInvitation(cfg, paragraph, asked, lens),
  };
}
