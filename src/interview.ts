// The Interview: everything the vault does to its owner, as operations over
// the vault and the model. See CONTEXT.md — Interview, Sitting, Draw, Ask,
// Revisit, Follow-up.
//
// Named for what CONTEXT.md calls it ("An Obsidian vault that interviews its
// owner"), not "session": the canon's Sitting entry rules that word out.
//
// It holds no state. It did until 2026-09-17, because two panes had to be
// able to redraw the same offer at any moment: what was drawn, what bonsai
// composed from it, what had been skipped, which reply was still wanted. Every
// one of those fields existed to be RENDERED. Offers are modals now
// (modals.ts) — one is open, or none is — so each one lives in the modal that
// shows it and dies with it. What is left here is what touches the vault.
//
// This was private state inside the Ask pane until 2026-09-16, which meant the
// interview had no interface but the DOM and no test could reach any of it.
// Every defect found to that date lived here, in how the pure functions were
// called rather than in the functions. That is why the seam stays even though
// the state is gone: a command reads the editor and hands over what it found;
// it decides nothing.

import type { App, TFile } from 'obsidian';
import { normalizePath } from 'obsidian';
import { answerText, asksOf, insertAsk, insertFirstAsk, markAnswered, parseAsks, questionsAbout } from './asks';
import type { Ask, AskOptions } from './asks';
import { bankJar, drawMany, parseDue, pickOne } from './bank';
import type { Drawn, JarCounts } from './bank';
import type { AnsweredIndex } from './answered';
import { ensureSourceBlockId } from './blocks';
import { readBookmark, runClosing } from './closing';
import { CRAFT, INVITATION, lensFor } from './lens';
import type { Composed, Model, RevisitCandidate } from './model';
import { paragraphAt } from './paragraphs';
import type { Paragraph } from './paragraphs';
import { refusalLine } from './refusal';
import { keyOfRef, parseRef } from './refs';
import type { Ref } from './refs';
import { selectionParagraph } from './selection';
import type { KeepWritingSettings } from './settings';
import { ME_BASENAME, isSitting, readTarget } from './target';
import type { ExtractionCache } from './extraction-cache';

/** What the Interview reads the vault and the model through. The plugin is one. */
export interface InterviewHost {
  extraction?: ExtractionCache;
  app: App;
  settings: KeepWritingSettings;
  index: AnsweredIndex;
  model: Model;
}

/**
 * The two things an Interview cannot do itself. The plugin is one adapter
 * (main.ts); a test is the other, and records the calls. Two adapters, so the
 * seam is a real one.
 */
export interface InterviewSurface {
  /**
   * Put the cursor at this line of this note. False when the owner is not
   * looking at that note, so the caller can say where the Ask landed instead.
   */
  placeCursor(file: TFile, line: number): boolean;
  /** Say one line to the owner. */
  notice(message: string): void;
}

/** What a draw found, and what the jars held while it looked. */
export interface Drawing {
  drawn: Drawn[];
  jars: JarCounts;
  /** The Target's name when the day is spent on one thing; null while roaming. */
  target: string | null;
}

/**
 * How the owner came by a paragraph, which decides everything about what is
 * asked of it.
 *
 * `pointed` — they highlighted it, so they went there on purpose and they want
 * to talk about THAT. The interviewer composes; the paragraph is embedded
 * under the Ask so it reads in place.
 *
 * `picked` — the draw handed it over, so they did not choose it and 99% of
 * what the draw can reach is years old. The Invitation composes: the paragraph
 * is a seed and the question aims at their present. It is NOT embedded —
 * showing the 2020 prose under a question about now undoes the work.
 */
export type Reach = 'pointed' | 'picked';

/**
 * Everything a reach decides, in one row per reach: which Lens page frames
 * the composer, which composer, and whether the paragraph is embedded under
 * the Ask. Three ternaries decided these separately until 2026-09-21, and a
 * third reach would have fallen into the `picked` arm of each without a word.
 */
const REACHES: Record<Reach, { lens: string; composer: 'revisit' | 'invitation'; embed: boolean }> = {
  pointed: { lens: CRAFT, composer: 'revisit', embed: true },
  picked: { lens: INVITATION, composer: 'invitation', embed: false },
};

/** The questions bonsai composed from a paragraph, and the Lens it read through. */
export interface RevisitOffer {
  candidates: RevisitCandidate[];
  lens: string | null;
  /** Why nothing was composed, when the reason was the call and not the model. */
  error: string | null;
}

/** What marking an answer produced: the answer block, and what follows from it. */
export interface Answered {
  ref: Ref;
  /** Follow-up questions bonsai composed, best first. Empty when it had none. */
  questions: string[];
  /**
   * Why there are none, when the reason was the call and not the model. Null
   * when the model simply had nothing to ask, which is a legal answer.
   */
  error: string | null;
}

/** The one fixed Revisit form, for when the model is off or offers nothing. A paragraph is never a dead end. */
export const REVISIT_FALLBACK = 'what would you write under this now?';

/**
 * How many sources a draw puts in front of the owner at once. More than one so
 * that Escape is the refusal and no set of refused sources has to be kept; few
 * enough to read at a glance. Eight for one day, 2026-09-17, and eight is a
 * wall of text: the owner is choosing, not shopping.
 */
export const DRAW_COUNT = 3;

export class Interview {
  constructor(
    private host: InterviewHost,
    private surface: InterviewSurface,
  ) {}

  private get app(): App {
    return this.host.app;
  }

  /**
   * The Sitting an Ask will land in: the note the owner is on when it is one,
   * today's otherwise, made from the template if today has none.
   */
  async sitting(active: TFile | null): Promise<TFile> {
    const folder = this.host.settings.sittingsFolder;
    if (isSitting(active, folder)) return active;
    return todaysSitting(this.app, folder);
  }

  // -------------------------------------------------------------------------
  // The draw

  /**
   * Several drawable sources at once, so the owner picks one and Escape
   * refuses the rest. The Sitting's own Asks never come back, and neither does
   * anything already answered.
   */
  async draw(sitting: TFile, count: number = DRAW_COUNT): Promise<Drawing> {
    await this.host.index.prepare();
    const target = readTarget(this.app, sitting);
    const ctx = await this.context(sitting);
    // The pick-up takes the first of the `count` rows, never an extra one:
    // the owner is choosing, not shopping.
    const pickUp = await this.pickUp(sitting, ctx.skipped);
    if (pickUp) ctx.skipped.add(pickUp.key);
    const { drawn, jars } = await drawMany(ctx, target, count - (pickUp ? 1 : 0));
    return {
      drawn: pickUp ? [{ source: pickUp, pickUp: true }, ...drawn] : drawn,
      jars,
      target: target?.basename ?? null,
    };
  }

  /**
   * Where the owner said to pick up, as a paragraph, or null when there is no
   * such place today. This is the whole of what reads `next`.
   *
   * It retires itself three ways, and none of them needs a flag written
   * anywhere:
   *
   * - **Followed.** Accepting a question from it and answering that question
   *   links an `answers` to the block, so the index calls it answered.
   * - **Replaced.** Answering tonight's Bookmark overwrites `next`.
   * - **Written today.** A Bookmark answered THIS Sitting points into this
   *   Sitting, and the edge it names is not behind the owner yet. The jar
   *   holds today's own blocks out for the same reason.
   */
  private async pickUp(sitting: TFile, placed: Set<string>): Promise<Paragraph | null> {
    const ref = readBookmark(this.app, sitting);
    if (!ref) return null;
    const paragraph = await paragraphAt(this.app, ref, this.host.settings.sittingsFolder);
    if (!paragraph || paragraph.file.path === sitting.path) return null;
    await this.host.index.prepare();
    if (this.host.index.has(paragraph.key) || placed.has(paragraph.key)) return null;
    return paragraph;
  }

  /**
   * A Sitting is born with one Bank question in it. Returns whether it wrote.
   *
   * The blank page is the failure mode — not stalling mid-answer, and not
   * forgetting to show up. This is the answer to it, so it has to hold in the
   * worst case: **no model call on this path, ever.** A Bank question is
   * another person's words, already written, and placing one cannot fail
   * because bonsai is off, or slow, or gone.
   *
   * It writes nothing into a Sitting whose `## Asked` section already holds
   * one, so running it on the same note twice is one question, and a note the
   * owner has been working in is never touched. The Closing move the template
   * carries in under its own heading does not count as written-in: that is
   * what `insertFirstAsk` asks `asksInSection` rather than `parseAsks`.
   */
  async seed(sitting: TFile): Promise<boolean> {
    const target = readTarget(this.app, sitting);
    const question = pickOne(await bankJar(await this.context(sitting), target));
    if (!question) return false;
    const due = question.due ? parseDue(question.due, new Date()) : null;
    return insertFirstAsk(this.app, sitting, question.text, question.ref, due ? { due } : {});
  }

  /** What the Draw reads the vault through, with this Sitting's Asks already placed. */
  private async context(sitting: TFile) {
    const { sittingsFolder, bankFolder, writingFolders } = this.host.settings;
    const placed = new Set<string>();
    for (const a of await asksOf(this.app, sitting)) {
      const ref = parseRef(a.sourceRef);
      const key = ref && keyOfRef(this.app, ref, sitting.path);
      if (key) placed.add(key);
    }
    return { app: this.app, bankFolder, sittingsFolder, writingFolders, bankShare: this.host.settings.bankShare, index: this.host.index, skipped: placed, sitting, extraction: this.host.extraction };
  }

  /** Write a drawn Bank question as an Ask, and put the cursor under it. */
  async accept(sitting: TFile, drawn: Drawn): Promise<void> {
    if (drawn.source.kind !== 'question') return;
    const line = await insertAsk(this.app, sitting, drawn.source.text, drawn.source.ref, drawn.due ? { due: drawn.due } : {});
    this.landed(sitting, line);
  }

  // -------------------------------------------------------------------------
  // The Revisit

  /**
   * The words the owner selected, as a paragraph source. Null when the
   * selection cannot be one; the reason is said to them here, because it is
   * the only thing that happens.
   */
  selection(picked: { file: TFile; selected: string; line: number; document?: string }): Paragraph | null {
    try {
      return selectionParagraph(
        this.app,
        picked.file,
        picked.selected,
        picked.line,
        this.host.settings.sittingsFolder,
        picked.document,
      );
    } catch (e) {
      this.surface.notice(refusalLine(e));
      return null;
    }
  }

  /**
   * Ask bonsai for questions from a paragraph. `reach` picks the composer and
   * the Lens: pointed at, and it is interviewed with its framing; picked by the
   * draw, and it seeds an Invitation with no framing at all. Without the model
   * the offer is empty, and the caller shows the fallback.
   */
  async offerFrom(paragraph: Paragraph, reach: Reach): Promise<RevisitOffer> {
    const { model } = this.host;
    const { lens: page, composer } = REACHES[reach];
    const lens = await lensFor(this.app, page);
    const name = lens ? page : null;
    if (!model.available) return { candidates: [], lens: name, error: null };
    const asked = await this.askedAbout(paragraph);
    const composed =
      composer === 'revisit'
        ? await model.composeRevisit(paragraph.text, paragraph.framing, asked, lens)
        : await model.composeInvitation(paragraph.text, asked, lens);
    return { candidates: composed.questions, lens: name, error: composed.error };
  }

  /**
   * Every question already put to the owner about this block, so a Revisit
   * cannot hand one of them back. A Sitting block is almost always the first
   * paragraph of an answer, so it carries at least the question it answers,
   * and any Follow-up composed from it since.
   *
   * Empty for a Piece, a Domain or a Learning paragraph. Those can carry an
   * Ask too, placed in some earlier Sitting, and finding it would mean
   * reading every Sitting on every draw. Not honest, but bounded: an
   * unanswered source is re-drawable by design, and the owner sees the
   * question before accepting it.
   */
  private async askedAbout(paragraph: Paragraph): Promise<string[]> {
    if (paragraph.origin !== 'sitting') return [];
    const asks = await asksOf(this.app, paragraph.file);
    return questionsAbout(asks, paragraph.line, (src) => {
      const ref = parseRef(src);
      return !!ref && keyOfRef(this.app, ref, paragraph.file.path) === paragraph.key;
    });
  }

  /**
   * Place the chosen question as an Ask, citing the paragraph it came from. A
   * paragraph with no block id yet is given one now, so the Ask can cite it. A
   * candidate with `dueDays` sets the Ask's due date — nothing asks for one
   * today, and a Lens is prose the owner edits, so any Lens can start.
   *
   * `pointed` embeds the paragraph under the from-line so it reads in place.
   * `picked` does not: the question is about the owner's present, and the old
   * prose sitting under it would pull them back into the year it came from.
   * The SOURCE is linked either way — that is what stops it coming back.
   */
  async acceptFrom(
    sitting: TFile,
    source: Paragraph,
    candidate: RevisitCandidate,
    reach: Reach,
  ): Promise<void> {
    this.host.extraction?.assertActive();
    let ref: Ref;
    try {
      ref = await ensureSourceBlockId(this.app, source);
    } catch (e) {
      this.surface.notice(refusalLine(e));
      return;
    }
    this.host.extraction?.assertActive();
    const opts: AskOptions = REACHES[reach].embed ? { embed: true } : {};
    const due = candidate.dueDays !== undefined ? parseDue(`+${candidate.dueDays}d`, new Date()) : null;
    if (due) opts.due = due;
    this.landed(sitting, await insertAsk(this.app, sitting, candidate.question, ref, opts));
  }

  // -------------------------------------------------------------------------
  // Answering

  /**
   * Mark whichever Ask's answer the cursor sits in, then go looking for what
   * follows. The caller reads the note and the line while the editor still
   * holds the focus and hands them over; which Ask that line is under, and
   * every way this can refuse, is decided here.
   *
   * **An answer already linked is not refused.** Marking it again writes
   * nothing — `ensureSourceBlockId` hands back the id it already has and
   * `linkBoth` skips a link that is already there — and the Follow-ups are
   * composed afresh. That is how the owner asks for another question about an
   * answer: put the cursor in it and run this again, today or next week. It
   * refused with "This answer is already linked." until 2026-09-17, which made
   * the Follow-up reachable exactly once, in the seconds after marking, and
   * never again if the chooser was dismissed.
   *
   * Null when nothing was marked. Every refusal is one line the owner reads.
   */
  async markAt(picked: { file: TFile; line: number }): Promise<Answered | null> {
    const { file, line } = picked;
    if (!isSitting(file, this.host.settings.sittingsFolder)) {
      this.surface.notice('The active note is not a Sitting.');
      return null;
    }
    const ask = (await asksOf(this.app, file)).find((a) => a.answer.start <= line && line < a.answer.end);
    if (!ask) {
      this.surface.notice('The cursor is not under an Ask.');
      return null;
    }

    const { bankFolder } = this.host.settings;
    const marked = await markAnswered(this.app, file, ask, { bankFolder });
    if (marked.kind === 'refused') {
      this.surface.notice(marked.reason);
      return null;
    }
    if (!ask.answered) this.surface.notice('Answer linked.');
    // A Closing move answers somewhere else too (the Bookmark writes `next`);
    // an ordinary question does not. The source decides, never the file it
    // sits in.
    const source = parseRef(ask.sourceRef);
    if (source) await runClosing(this.app, file, source, marked.ref, bankFolder);
    const followed = await this.followUps(file, ask);
    return { ref: marked.ref, questions: followed.questions, error: followed.error };
  }

  /**
   * Follow-up questions bonsai composes from an answer, given the question it
   * answered and every other question this Sitting has already put.
   *
   * Re-reads and re-parses first. Marking has just written a block id AND an
   * `answers` property, and a frontmatter write moves every line of the body
   * below it — by two lines when the property is the note's first. The ranges
   * on `ask` were parsed before that write, so they no longer point at the
   * answer. Measured 2026-09-16: handed a stale range, bonsai was shown the
   * Ask callout and composed a follow-up to the question's own text.
   */
  private async followUps(file: TFile, ask: Ask): Promise<Composed<string>> {
    const { model } = this.host;
    if (!model.available) return { questions: [], error: null };
    const content = await this.app.vault.cachedRead(file);
    const asks = parseAsks(content);
    const fresh = asks.find((a) => a.sourceRef === ask.sourceRef && a.question === ask.question) ?? ask;
    const answer = answerText(content, fresh);
    if (!answer) return { questions: [], error: null };
    const target = readTarget(this.app, file)?.basename ?? ME_BASENAME;
    // Every other question this Sitting has already put. composeFollowUps
    // adds the one being answered itself.
    const alsoAsked = asks.map((a) => a.question).filter((q) => q !== ask.question);
    return model.composeFollowUps(ask.question, answer, alsoAsked, target);
  }

  /** Write one of the offered Follow-ups as an Ask, cited to the answer it came from. */
  async acceptFollowUp(sitting: TFile, question: string, sourceRef: Ref): Promise<void> {
    this.landed(sitting, await insertAsk(this.app, sitting, question, sourceRef));
  }

  /**
   * An Ask was written: put the cursor under it, or say where it went when the
   * owner is reading something else. The Ask always lands in a Sitting; the
   * owner does not always have that Sitting open.
   */
  private landed(sitting: TFile, line: number): void {
    if (!this.surface.placeCursor(sitting, line)) this.surface.notice(`Asked in ${sitting.basename}.`);
  }
}

const DEFAULT_TEMPLATE = '## Asked\n';

/**
 * Pure: a day as a Sitting's name, `YYYY-MM-DD`, in local time.
 *
 * This was `moment().format('YYYY-MM-DD')` until 2026-09-17. Obsidian re-exports
 * moment, but its declaration is `import * as Moment from 'moment'`, which
 * resolves to `any` wherever that package is not installed beside it — so the
 * one date in the plugin was an unchecked call, and the community review said
 * so. Four lines of Date owe nothing to a dependency and can be tested.
 */
export function dayStamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Today's Sitting as a file, made from Templates/Sitting.md (verbatim) when
 * today has none. Where an Ask goes when the owner is reading something that
 * is not a Sitting.
 */
export async function todaysSitting(app: App, sittingsFolder: string, today: Date = new Date()): Promise<TFile> {
  // Every vault path the plugin builds goes through `normalizePath`: the
  // folder is whatever the owner typed into settings, and it scrubs repeated
  // or backward slashes, leading and trailing ones, and non-breaking spaces.
  const folder = normalizePath(sittingsFolder);
  const path = normalizePath(`${folder}/${dayStamp(today)}.md`);
  const existing = app.vault.getFileByPath(path);
  if (existing) return existing;
  const template = app.vault.getFileByPath(normalizePath('Templates/Sitting.md'));
  const body = template ? await app.vault.cachedRead(template) : DEFAULT_TEMPLATE;
  if (!app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
  return app.vault.create(path, body);
}

/** Pure: what the draw says it is choosing among, while roaming. */
export function jarsLine(jars: JarCounts): string {
  const q = `${jars.questions} question${jars.questions === 1 ? '' : 's'}`;
  const p = `${jars.paragraphs} paragraph${jars.paragraphs === 1 ? '' : 's'}`;
  return `roaming · ${q} · ${p}`;
}
