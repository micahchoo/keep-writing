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
import { moment } from 'obsidian';
import { answerText, asksOf, insertAsk, markAnswered, parseAsks, questionsAbout } from './asks';
import type { Ask, AskOptions } from './asks';
import { drawMany, parseDue } from './bank';
import type { AnsweredIndex, Drawn, JarCounts } from './bank';
import { ensureBlockId } from './blocks';
import { runClosing } from './closing';
import { CRAFT, lensFor } from './lens';
import type { Model, RevisitCandidate } from './model';
import type { Paragraph } from './paragraphs';
import { refusalLine } from './refusal';
import { keyOfRef, parseRef } from './refs';
import type { Ref } from './refs';
import { selectionParagraph } from './selection';
import type { KeepWritingSettings } from './settings';
import { ME_BASENAME, isSitting, readTarget } from './target';

/** What the Interview reads the vault and the model through. The plugin is one. */
export interface InterviewHost {
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

/** The questions bonsai composed about a paragraph, and the Lens it read through. */
export interface RevisitOffer {
  candidates: RevisitCandidate[];
  lens: string | null;
}

/** What marking an answer produced: the answer block, and what follows from it. */
export interface Answered {
  ref: Ref;
  /** Follow-up questions bonsai composed, best first. Empty when it had none. */
  questions: string[];
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
    if (isSitting(active, folder)) return active as TFile;
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
    const target = readTarget(this.app, sitting);
    const { drawn, jars } = await drawMany(await this.context(sitting), target, count);
    return { drawn, jars, target: target?.basename ?? null };
  }

  /** What the Draw reads the vault through, with this Sitting's Asks already placed. */
  private async context(sitting: TFile) {
    const { sittingsFolder, bankFolder } = this.host.settings;
    const placed = new Set<string>();
    for (const a of await asksOf(this.app, sitting)) {
      const ref = parseRef(a.sourceRef);
      const key = ref && keyOfRef(this.app, ref, sitting.path);
      if (key) placed.add(key);
    }
    return { app: this.app, bankFolder, sittingsFolder, index: this.host.index, skipped: placed, sitting };
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
  selection(picked: { file: TFile; selected: string; line: number }): Paragraph | null {
    try {
      return selectionParagraph(
        this.app,
        picked.file,
        picked.selected,
        picked.line,
        this.host.settings.sittingsFolder,
      );
    } catch (e) {
      this.surface.notice(refusalLine(e));
      return null;
    }
  }

  /**
   * Ask bonsai for questions about a paragraph, with one line of framing (when
   * and where it was written) and the Well's Lens. Without the model the offer
   * is empty, and the caller shows the fallback.
   */
  async revisitOffer(paragraph: Paragraph): Promise<RevisitOffer> {
    const { model } = this.host;
    const lens = await lensFor(this.app);
    const name = lens ? CRAFT : null;
    if (!model.available) return { candidates: [], lens: name };
    const asked = await this.askedAbout(paragraph);
    return { candidates: await model.composeRevisit(paragraph.text, paragraph.framing, asked, lens), lens: name };
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
   * Place a Revisit: the chosen question as the Ask, the paragraph as its
   * source, embedded under the from-line. A paragraph with no block id yet (a
   * Domain or Learning body) is given one now, so the Ask can cite it. A
   * candidate with `dueDays` sets the Ask's due date.
   */
  async acceptRevisit(sitting: TFile, source: Paragraph, candidate: RevisitCandidate): Promise<void> {
    let ref = source.ref;
    if (!ref.blockId) {
      try {
        ref = await ensureBlockId(this.app, source.file, source.line);
      } catch (e) {
        this.surface.notice(refusalLine(e));
        return;
      }
    }
    const opts: AskOptions = { embed: true };
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
   * nothing — `ensureBlockId` hands back the id it already has and
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
    return { ref: marked.ref, questions: await this.followUps(file, ask) };
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
  private async followUps(file: TFile, ask: Ask): Promise<string[]> {
    const { model } = this.host;
    if (!model.available) return [];
    const content = await this.app.vault.cachedRead(file);
    const asks = parseAsks(content);
    const fresh = asks.find((a) => a.sourceRef === ask.sourceRef && a.question === ask.question) ?? ask;
    const answer = answerText(content, fresh);
    if (!answer) return [];
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
 * Today's Sitting as a file, made from Templates/Sitting.md (verbatim) when
 * today has none. Where an Ask goes when the owner is reading something that
 * is not a Sitting.
 */
export async function todaysSitting(app: App, sittingsFolder: string): Promise<TFile> {
  const path = `${sittingsFolder}/${moment().format('YYYY-MM-DD')}.md`;
  const existing = app.vault.getFileByPath(path);
  if (existing) return existing;
  const template = app.vault.getFileByPath('Templates/Sitting.md');
  const body = template ? await app.vault.cachedRead(template) : DEFAULT_TEMPLATE;
  if (!app.vault.getFolderByPath(sittingsFolder)) await app.vault.createFolder(sittingsFolder);
  return app.vault.create(path, body);
}

/** Pure: what the draw says it is choosing among, while roaming. */
export function jarsLine(jars: JarCounts): string {
  const q = `${jars.questions} question${jars.questions === 1 ? '' : 's'}`;
  const p = `${jars.paragraphs} paragraph${jars.paragraphs === 1 ? '' : 's'}`;
  return `roaming · ${q} · ${p}`;
}
