// The one offer that outlives its modal.
//
// Every other offer the Interview makes lives in the modal that shows it
// (modals.ts). The Follow-ups composed from an answer are different: they cost
// a model call, the owner may dismiss them tonight and want them tomorrow, so
// they are kept in the plugin's data and reopened from the command palette.
//
// Kept means rules: which offer is current, that a question leaves it only
// once its Ask is written, that two clicks write once, and that an offer shown
// before a newer one replaced it accepts nothing. Until 2026-09-21 those rules
// were two fields on the plugin and four guards in a click handler, where no
// test could construct them. The plugin keeps persistence and the chooser;
// the rules are here.

import type { App, TFile } from 'obsidian';
import type { Ref } from './refs';

/** The Follow-ups bonsai composed from one answer, and the Sitting they belong in. */
export interface FollowUpOffer {
  sitting: string;
  /** The answer block the questions were composed from; every accepted Ask cites it. */
  ref: Ref;
  questions: string[];
}

/** What the plugin stored, read back at the storage boundary. Null for anything that is not an offer. */
export function readOffer(value: unknown): FollowUpOffer | null {
  if (!value || typeof value !== 'object' || !('sitting' in value) || typeof value.sitting !== 'string' || !('ref' in value) || !value.ref || typeof value.ref !== 'object' || !('path' in value.ref) || typeof value.ref.path !== 'string' || !('blockId' in value.ref) || typeof value.ref.blockId !== 'string' || !('questions' in value) || !Array.isArray(value.questions) || !value.questions.every((q: unknown) => typeof q === 'string' && q.trim())) return null;
  return { sitting: value.sitting, ref: { path: value.ref.path, blockId: value.ref.blockId }, questions: value.questions as string[] };
}

export const NO_SAVED_OFFER = 'No saved follow-ups. Mark an answer done to compose some.';
export const OFFER_SOURCE_MISSING = 'The saved offer’s source is missing or still indexing. No question was inserted.';

/**
 * The Sitting a saved offer's questions land in, or the one line that says why
 * they cannot: the note is gone, or the answer block it cites is not in the
 * metadata cache yet, and an Ask citing a block nobody can resolve is worse
 * than no Ask.
 */
export function offerSitting(app: App, offer: FollowUpOffer): TFile | string {
  const file = app.vault.getFileByPath(offer.sitting);
  const source = app.metadataCache.getFirstLinkpathDest(offer.ref.path, offer.sitting);
  if (!file || !source || !offer.ref.blockId || !app.metadataCache.getFileCache(source)?.blocks?.[offer.ref.blockId]) return OFFER_SOURCE_MISSING;
  return file;
}

export class SavedOffer {
  private offer: FollowUpOffer | null;
  private accepting = false;

  /** `persist` writes the offer wherever the plugin keeps it; null clears it. */
  constructor(initial: FollowUpOffer | null, private readonly persist: (offer: FollowUpOffer | null) => Promise<void>) {
    this.offer = initial;
  }

  get current(): FollowUpOffer | null {
    return this.offer;
  }

  /**
   * A fresh offer replaces whatever was kept. It is current from this moment
   * even if persisting it fails: the caller says so, and the owner still has
   * it for the session.
   */
  async replace(offer: FollowUpOffer): Promise<void> {
    this.offer = offer;
    await this.persist(offer);
  }

  /**
   * Accept one question of the offer the owner was shown. `write` places the
   * Ask; the question leaves the offer only once it has. False when nothing
   * was written: the offer shown is not the current one, the question is no
   * longer in it, or another acceptance is still running.
   */
  async accept(shown: FollowUpOffer, question: string, write: () => Promise<void>): Promise<boolean> {
    if (this.accepting || this.offer !== shown || !shown.questions.includes(question)) return false;
    this.accepting = true;
    try {
      await write();
      // Replaced while the Ask was being written: the newer offer stands.
      if (this.offer !== shown) return true;
      this.offer = { ...shown, questions: shown.questions.filter((q) => q !== question) };
      await this.persist(this.offer);
      return true;
    } finally {
      this.accepting = false;
    }
  }
}
