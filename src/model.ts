// The model seam. Everything that needs bonsai (Follow-ups, Revisits) goes
// through a `Model`. Wired to src/bonsai.ts; when the model is
// switched off in settings the seam reports "not available" and returns
// nothing, so every caller degrades to the bank-only behaviour.
//
// Only jobs bonsai does live here. A third one, proposeRelation, was taken out
// on 2026-09-17: it read every answer against five lexically-near blocks and
// had produced one link in the vault's life.

import { requestUrl } from 'obsidian';
import { composeFollowUps, composeInvitation, composeRevisit, suggestHeadings, summarizeThread } from './bonsai';
import type { BonsaiConfig, CallLog, RevisitCandidate, SectionText } from './bonsai';
import type { KeepWritingSettings } from './settings';

export type { CallLog, RevisitCandidate, SectionText };

/**
 * What one compose call produced.
 *
 * `questions` empty with `error` null is the model DECLINING — it read the
 * answer and had nothing to ask. That is a legal outcome and is never worked
 * around. `questions` empty with an `error` is the call never reaching the
 * model at all, or reaching it and coming back unusable.
 *
 * They were the same value, `[]`, until 2026-09-18, so every caller above
 * this line reported a dead endpoint as the model having nothing to say. A
 * 404 naming the wrong model id came out as "Nothing to follow up with",
 * while the server's own explanation sat in the console log, unread. This is
 * the same conflation `chat()` fixed one level down, at the seam above it.
 */
export interface Composed<T> {
  questions: T[];
  error: string | null;
}

export interface Model {
  /** False when the model is switched off in settings. */
  readonly available: boolean;
  /** Why it is unavailable, for the pane. Empty when available. */
  readonly reason: string;
  /** Up to three follow-up questions, best first. `asked` is every other question already put in this Sitting. */
  composeFollowUps(question: string, answer: string, asked: string[], target: string): Promise<Composed<string>>;
  /** Up to three questions ABOUT a paragraph the owner pointed at. `asked` is what was already asked from that block. */
  composeRevisit(paragraph: string, framing: string, asked: string[], lens: string): Promise<Composed<RevisitCandidate>>;
  /** Up to three invitations SEEDED by a paragraph the draw found, aimed at the owner's present. No framing: see INVITATION_SYSTEM. */
  composeInvitation(paragraph: string, asked: string[], lens: string): Promise<Composed<RevisitCandidate>>;
  /** Up to three lines on what a thread is about, to name a Piece by. Shown, never written. */
  summarize(sections: SectionText[]): Promise<Composed<string>>;
  /** One heading per section, in order, offered to the owner. Written only if they pick it. */
  suggestHeadings(sections: SectionText[]): Promise<Composed<string>>;
}

/**
 * Nothing composed, and nothing wrong: the model is off, or it declined.
 * A function, not a shared constant — callers get their own array.
 */
function nothing<T>(): Composed<T> {
  return { questions: [], error: null };
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
      composeFollowUps: async () => nothing(),
      composeRevisit: async () => nothing(),
      composeInvitation: async () => nothing(),
      summarize: async () => nothing(),
      suggestHeadings: async () => nothing(),
    };
  }
  const base: BonsaiConfig = { baseUrl: settings.baseUrl, model: settings.model, fetcher, maxTokens: settings.maxTokens };
  if (settings.apiKey.trim()) base.apiKey = settings.apiKey.trim();

  /**
   * Run one compose call and keep whatever went wrong inside it.
   *
   * The reason is already written — `runJob` logs every outcome with one — so
   * this reads it off a log sink scoped to THIS call rather than inventing a
   * second channel. Scoped, not ambient: the collector is a field of the
   * config handed to this call and nothing else, so two calls in flight
   * cannot see each other's failures.
   *
   * A composer can fail once and still succeed: `composeFollowUps` falls
   * through to an answer-only second arm. So the error is reported only when
   * nothing was composed — a recovered failure is not the user's problem.
   */
  async function composing<T>(call: (cfg: BonsaiConfig) => Promise<T[]>): Promise<Composed<T>> {
    let failure: string | null = null;
    const cfg: BonsaiConfig = {
      ...base,
      onLog: (entry) => {
        // `invalid` is the model answering badly, which is the model speaking;
        // only `error` means the exchange itself did not happen.
        if (entry.outcome === 'error') failure = entry.reason ?? 'the call failed';
        onLog?.(entry);
      },
    };
    const questions = await call(cfg);
    return { questions, error: questions.length > 0 ? null : failure };
  }

  return {
    available: true,
    reason: '',
    composeFollowUps: (question, answer, asked, target) =>
      composing((cfg) => composeFollowUps(cfg, question, answer, asked, target)),
    composeRevisit: (paragraph, framing, asked, lens) =>
      composing((cfg) => composeRevisit(cfg, paragraph, framing, asked, lens)),
    composeInvitation: (paragraph, asked, lens) => composing((cfg) => composeInvitation(cfg, paragraph, asked, lens)),
    summarize: (sections) => composing((cfg) => summarizeThread(cfg, sections)),
    suggestHeadings: (sections) => composing((cfg) => suggestHeadings(cfg, sections)),
  };
}
