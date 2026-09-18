// The Interview: one Sitting's worth of it, as state and intents — what is
// drawn, what bonsai composed from it, what the owner has already been asked,
// and what a fresh answer might relate to. See CONTEXT.md — Interview,
// Sitting, Draw, Ask, Revisit, Follow-up, Proposal.
//
// Named for what CONTEXT.md calls it ("An Obsidian vault that interviews its
// owner"), not "session": the canon's Sitting entry rules that word out.
//
// This was private state inside the Ask pane until 2026-09-16, which meant the
// interview had no interface but the DOM and no test could reach any of it.
// Every defect found so far lived here, in how the pure functions were called
// rather than in the functions: a composer measured against an empty Asked
// set, a pane that needed two clicks. The pure parts (bank.ts, bonsai.ts,
// paragraphs.ts) were well tested the whole time.
//
// The Interview touches the vault and the model. It never touches the DOM: the
// three things it cannot do itself — draw, put the cursor somewhere, say one
// line to the owner — it asks its Surface for.
//
// The PLUGIN owns it, one per vault, and builds that Surface. It was built
// inside AskView's constructor until 2026-09-17, so it was one per PANE: two
// Ask panes were two skipped sets over one Sitting, closing the pane threw the
// state away, and every command had to open a pane to reach an intent.

import type { App, TFile } from 'obsidian';
import { moment } from 'obsidian';
import { answerText, asksOf, insertAsk, markAnswered, parseAsks, questionsAbout } from './asks';
import type { Ask, AskOptions } from './asks';
import { draw, parseDue } from './bank';
import type { AnsweredIndex, DrawSource, Drawn, JarCounts } from './bank';
import { ensureBlockId } from './blocks';
import { runClosing } from './closing';
import { lensFor, lensName } from './lens';
import { linkBoth } from './links';
import type { Model, RevisitCandidate } from './model';
import type { Paragraph } from './paragraphs';
import { proposalFor } from './proposal';
import { refusalLine } from './refusal';
import type { ProposalOffer } from './proposal';
import { keyOfRef, parseRef } from './refs';
import type { Ref } from './refs';
import { selectionParagraph } from './selection';
import type { KeepWritingSettings } from './settings';
import { SELF, ME_BASENAME, allWells, isSitting, readTarget } from './target';
import type { Target, Well } from './target';

/** What the Interview reads the vault and the model through. The plugin is one. */
export interface InterviewHost {
  app: App;
  settings: KeepWritingSettings;
  index: AnsweredIndex;
  model: Model;
}

/**
 * The three things an Interview cannot do itself. The plugin is one adapter
 * (main.ts: `changed` draws every open Ask pane, `placeCursor` and `notice`
 * are workspace work no pane owns); a test is the other, and records the
 * calls. Two adapters, so the seam is a real one.
 */
export interface InterviewSurface {
  /** The state changed; draw it. */
  changed(): void;
  /** Put the cursor at this line of this note, if the owner is looking at it. */
  placeCursor(file: TFile, line: number): void;
  /** Say one line to the owner. */
  notice(message: string): void;
}

/** Follow-up questions bonsai composed from an answer, until accepted or dismissed. */
export interface FollowUpOffer {
  /** Up to three candidates, best first. */
  questions: string[];
  /** The answer block the questions came from; the Ask's source. */
  sourceRef: Ref;
}

/**
 * The Proposals area: idle until an answer is marked, thinking while bonsai
 * reads, then whatever proposal.ts hands back. An offer carries the answer
 * block too, because accepting it writes the link from there.
 */
export type ProposalState =
  | { kind: 'idle' }
  | { kind: 'thinking' }
  | Extract<ProposalOffer, { kind: 'none' }>
  | (Extract<ProposalOffer, { kind: 'offer' }> & { answerRef: Ref });

/**
 * The questions bonsai composed for the drawn paragraph. `key` is the
 * paragraph's, so a reply that lands after a redraw is dropped. `lens` names
 * the Lens the composition read through, when the Well has one. An empty
 * offer shows the one fixed fallback question.
 */
export type RevisitState =
  | { kind: 'idle' }
  | { kind: 'composing'; key: string; lens: string | null }
  | { kind: 'offer'; key: string; lens: string | null; candidates: RevisitCandidate[] };

/** Everything the pane draws. Read it, never write it. */
export interface InterviewState {
  /** The note the pane follows. */
  file: TFile | null;
  /** True when that note is a Sitting, so the interview can run in it. */
  inSitting: boolean;
  /** `about` on the Sitting: the day is spent on one Well or one Piece. */
  target: Target | null;
  /** The Sitting's Asks, answered and open. */
  asks: Ask[];
  /** The source in the card: a bank question, or a paragraph to revisit. */
  drawn: Drawn | null;
  /** What the two jars held at the last draw: the header's numbers. */
  jars: JarCounts;
  /** Which part of the Bank the last draw read. */
  source: DrawSource;
  /** A draw is in flight. */
  loading: boolean;
  /** The card holds words the owner selected, not a source the draw found. */
  fromSelection: boolean;
  followUp: FollowUpOffer | null;
  proposal: ProposalState;
  revisit: RevisitState;
}

/** The one fixed Revisit form, for when the model is off or offers nothing. A paragraph is never a dead end. */
export const REVISIT_FALLBACK = 'what would you write under this now?';

export class Interview {
  private s: InterviewState = {
    file: null,
    inSitting: false,
    target: null,
    asks: [],
    drawn: null,
    jars: { questions: 0, paragraphs: 0, wells: 0 },
    source: 'target',
    loading: false,
    fromSelection: false,
    followUp: null,
    proposal: { kind: 'idle' },
    revisit: { kind: 'idle' },
  };

  /** Source keys not to draw again while this Interview runs: skipped, or accepted before the cache caught up. */
  private readonly skipped = new Set<string>();

  /**
   * Which draw is the current one. A draw reads the whole Bank and the whole
   * paragraph jar, so two of them overlap easily — Bookmark, Open door and
   * Back to bank never disable, and a command runs with no pane at all, so
   * there is no button to disable. Without this, whichever call RESOLVES last
   * wins rather than whichever the owner asked for last, and the card can come
   * back showing the source they just skipped.
   */
  private draws = 0;

  constructor(
    private host: InterviewHost,
    private surface: InterviewSurface,
  ) {}

  get state(): Readonly<InterviewState> {
    return this.s;
  }

  private get app(): App {
    return this.host.app;
  }

  /** The tracked note when it is a Sitting; null otherwise. An Ask only ever lands in a Sitting. */
  private sitting(): TFile | null {
    return isSitting(this.s.file, this.host.settings.sittingsFolder) ? this.s.file : null;
  }

  // -------------------------------------------------------------------------
  // Following the owner

  /**
   * Follow the active note. Returns false when nothing changed, so the pane
   * can leave the DOM alone: a click inside the pane makes it the active leaf
   * and arrives here with no markdown view, and an unconditional render there
   * empties `contentEl` between mousedown and mouseup — the button under the
   * pointer dies with it and the browser dispatches no click. That is what
   * made the pane need a second click. See .claude/rules/keep-writing-pane-render.md.
   */
  async track(file: TFile | null): Promise<boolean> {
    const next = file ?? this.s.file;
    if (next?.path === this.s.file?.path) return false;
    this.s.file = next ?? null;
    this.s.drawn = null;
    this.s.followUp = null;
    this.s.proposal = { kind: 'idle' };
    this.s.revisit = { kind: 'idle' };
    this.s.fromSelection = false;
    await this.readSitting();
    // The note changed, so everything the pane draws did: say so once, here,
    // rather than leaving it to reloadAsks, which must stay silent when the
    // Asks are the same.
    this.surface.changed();
    if (this.sitting()) await this.redraw('target');
    return true;
  }

  /**
   * Re-read the Sitting's Asks and its Target, and draw ONLY if they moved.
   *
   * This runs on `metadataCache.changed`, which fires while the owner types an
   * answer — a save that added a word changes no Ask. An unconditional draw
   * there empties `contentEl` between a mousedown and a mouseup and swallows
   * the click, which is what made the panes need a second click twice before.
   * See .claude/rules/keep-writing-pane-render.md.
   */
  async reloadAsks(): Promise<void> {
    const before = this.sittingSignature();
    await this.readSitting();
    if (this.sittingSignature() !== before) this.surface.changed();
  }

  private async readSitting(): Promise<void> {
    const sitting = this.sitting();
    this.s.inSitting = !!sitting;
    this.s.asks = sitting ? await asksOf(this.app, sitting) : [];
    this.s.target = sitting ? readTarget(this.app, sitting) : null;
  }

  /** Everything the pane draws off the Sitting itself, as one comparable string. */
  private sittingSignature(): string {
    return JSON.stringify([
      this.s.inSitting,
      this.s.target?.name ?? '',
      this.s.asks.map((a) => [a.question, a.sourceRef, a.answered, !!a.firstParagraph, a.callout.start]),
    ]);
  }

  // -------------------------------------------------------------------------
  // The draw

  /** Draw a fresh source from `source`; the Sitting's existing Asks never come back. */
  async redraw(source: DrawSource = this.s.source): Promise<void> {
    const sitting = this.sitting();
    if (!sitting) return;
    this.s.source = source;
    this.s.fromSelection = false;

    const placed = new Set(this.skipped);
    for (const a of this.s.asks) {
      const ref = parseRef(a.sourceRef);
      const key = ref && keyOfRef(this.app, ref, sitting.path);
      if (key) placed.add(key);
    }

    const ticket = ++this.draws;
    this.s.loading = true;
    this.surface.changed();
    const { sittingsFolder, bankFolder } = this.host.settings;
    const result = await draw(
      { app: this.app, bankFolder, sittingsFolder, index: this.host.index, skipped: placed, sitting },
      readTarget(this.app, sitting),
      source,
    );
    // A draw that lands after a newer one was asked for belongs to a card
    // nobody is waiting on. The newer draw owns `loading` and the state.
    if (ticket !== this.draws) return;
    this.s.drawn = result.drawn;
    this.s.jars = result.jars;
    this.s.loading = false;
    this.s.revisit = { kind: 'idle' };
    this.surface.changed();

    const drawn = result.drawn;
    if (drawn?.source.kind === 'paragraph' && drawn.well) await this.composeRevisit(drawn.source, drawn.well);
  }

  /** Put the drawn source back in the bag and draw another. */
  skip(): void {
    if (this.s.drawn) this.skipped.add(this.s.drawn.source.key);
    void this.redraw();
  }

  /** Accept the drawn bank question: write the Ask and draw the next one. */
  async accept(): Promise<void> {
    const sitting = this.sitting();
    const drawn = this.s.drawn;
    if (!drawn || !sitting || drawn.source.kind !== 'question') return;
    const { source, due } = drawn;
    const line = await insertAsk(this.app, sitting, source.text, source.ref, due ? { due } : {});
    this.surface.placeCursor(sitting, line);
    this.skipped.add(source.key);
    await this.redraw('target');
  }

  // -------------------------------------------------------------------------
  // The Revisit

  /**
   * Take the words the owner selected as the source, wherever they are, and
   * compose about them exactly as a Revisit composes about a drawn paragraph.
   * The pane reads the editor and hands the selection here.
   */
  async askAbout(picked: { file: TFile; selected: string; line: number }): Promise<void> {
    let paragraph: Paragraph;
    try {
      paragraph = selectionParagraph(
        this.app,
        picked.file,
        picked.selected,
        picked.line,
        this.host.settings.sittingsFolder,
      );
    } catch (e) {
      this.surface.notice(refusalLine(e));
      return;
    }
    // The owner asked for this one by hand, so a skip earlier today does not
    // stand, and answered-ness does not bar it.
    this.skipped.delete(paragraph.key);
    const well = this.wellNamed(paragraph.wells[0]);
    this.s.drawn = { source: paragraph, well };
    this.s.fromSelection = true;
    this.s.loading = false;
    this.s.revisit = { kind: 'idle' };
    this.surface.changed();
    await this.composeRevisit(paragraph, well);
  }

  /** Put a selection's card away. A selection is not the draw's to move on from. */
  dismissSelection(): void {
    this.s.drawn = null;
    this.s.fromSelection = false;
    this.s.revisit = { kind: 'idle' };
    this.surface.changed();
  }

  /**
   * Ask bonsai for questions about the drawn paragraph, with one line of
   * framing (when and where it was written) and the Well's Lens. Without the
   * model, or when it offers nothing, the offer is empty and the pane shows
   * the fallback.
   */
  private async composeRevisit(paragraph: Paragraph, well: Well): Promise<void> {
    const key = paragraph.key;
    const { model } = this.host;
    const lens = await lensFor(this.app, well);
    const asked = await this.askedAbout(paragraph);
    const name = lens ? lensName(well) : null;
    if (!model.available) {
      this.s.revisit = { kind: 'offer', key, lens: name, candidates: [] };
      this.surface.changed();
      return;
    }
    this.s.revisit = { kind: 'composing', key, lens: name };
    this.surface.changed();
    const candidates = await model.composeRevisit(paragraph.text, paragraph.framing, asked, lens);
    // A reply that lands after a redraw belongs to a paragraph nobody is
    // looking at any more.
    if (this.s.drawn?.source.kind !== 'paragraph' || this.s.drawn.source.key !== key) return;
    this.s.revisit = { kind: 'offer', key, lens: name, candidates };
    this.surface.changed();
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

  /** The Well a paragraph is filed under, for its Lens. The self when the name is not a Well. */
  private wellNamed(name: string | undefined): Well {
    return allWells(this.app).find((w) => w.name === name) ?? SELF;
  }

  /**
   * Place a Revisit: the chosen question as the Ask, the paragraph as its
   * source, embedded under the from-line. A paragraph with no block id yet (a
   * Domain or Learning body) is given one now, so the Ask can cite it. A
   * candidate with `dueDays` sets the Ask's due date.
   */
  async acceptRevisit(candidate: RevisitCandidate): Promise<void> {
    const drawn = this.s.drawn;
    if (!drawn || drawn.source.kind !== 'paragraph') return;
    const source = drawn.source;
    // An Ask always lands in a Sitting. When the owner picked the paragraph
    // out of a Piece they were reading, that is today's Sitting, made now if
    // today has none yet.
    const folder = this.host.settings.sittingsFolder;
    const sitting = this.sitting() ?? (await todaysSitting(this.app, folder));

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
    const line = await insertAsk(this.app, sitting, candidate.question, ref, opts);
    this.skipped.add(source.key);

    if (sitting.path === this.s.file?.path) {
      this.surface.placeCursor(sitting, line);
      await this.redraw('target');
      return;
    }
    this.surface.notice(`Asked in ${sitting.basename}.`);
    this.dismissSelection();
  }

  // -------------------------------------------------------------------------
  // Answering

  /** Mark an Ask's answer done from the pane, then go looking for what follows. */
  async mark(ask: Ask): Promise<void> {
    const sitting = this.sitting();
    if (sitting) await this.markIn(sitting, ask);
  }

  /**
   * Mark whichever Ask's answer the cursor sits in. The caller reads the note
   * and the line while the editor still holds the focus and hands them over,
   * exactly as it does for a Selection: opening the pane makes the pane the
   * active leaf, so neither can be read from here.
   *
   * Three refusals, each one line for the owner. This was a command body in
   * main.ts until 2026-09-16 — the same intent as `mark`, written twice, and
   * the copy that could not be tested was the one with all the refusals in it.
   */
  async markAt(picked: { file: TFile; line: number }): Promise<void> {
    const { file, line } = picked;
    if (!isSitting(file, this.host.settings.sittingsFolder)) {
      this.surface.notice('The active note is not a Sitting.');
      return;
    }
    const ask = (await asksOf(this.app, file)).find((a) => a.answer.start <= line && line < a.answer.end);
    if (!ask) {
      this.surface.notice('The cursor is not under an Ask.');
      return;
    }
    if (ask.answered) {
      this.surface.notice('This answer is already linked.');
      return;
    }
    await this.markIn(file, ask);
  }

  /**
   * Mark one Ask of one Sitting done and chain the two things that follow: the
   * Closing move the source calls for, if it is one, and bonsai's reading of
   * the answer. Every refusal is a line the owner reads; markAnswered hands
   * back the reason rather than saying it itself, so this is the only place
   * that speaks.
   */
  private async markIn(sitting: TFile, ask: Ask): Promise<void> {
    const { bankFolder } = this.host.settings;
    const marked = await markAnswered(this.app, sitting, ask, { bankFolder });
    if (marked.kind === 'refused') {
      this.surface.notice(marked.reason);
      return;
    }
    this.surface.notice('Answer linked.');
    // A Closing move answers somewhere else too (the Bookmark writes `next`);
    // an ordinary question does not. The source decides, never the file it
    // sits in.
    const source = parseRef(ask.sourceRef);
    if (source) await runClosing(this.app, sitting, source, marked.ref, bankFolder);
    await this.afterAnswer(sitting, marked.ref, ask);
  }

  /**
   * After an answer is marked: ask bonsai for Follow-ups, given the question
   * and the whole answer, and for one Proposal against the blocks code finds
   * lexically. The two jobs run together and each shows as it lands; both may
   * come back empty.
   */
  async afterAnswer(file: TFile, answerRef: Ref, ask: Ask): Promise<void> {
    const { model } = this.host;
    if (!model.available) return;

    // Re-read and re-parse. Marking has just written a block id AND an
    // `answers` property, and a frontmatter write moves every line of the body
    // below it — by two lines when the property is the note's first. The
    // ranges on `ask` were parsed before that write, so they no longer point
    // at the answer. Measured 2026-09-16: handed a stale range, bonsai was
    // shown the Ask callout and composed a follow-up to the question's own
    // text. One read serves both the answer and the Asked set.
    const content = await this.app.vault.cachedRead(file);
    const asks = parseAsks(content);
    const fresh = asks.find((a) => a.sourceRef === ask.sourceRef && a.question === ask.question) ?? ask;
    const answer = answerText(content, fresh);
    if (!answer) return;

    const target = readTarget(this.app, file)?.name ?? ME_BASENAME;
    // Every other question this Sitting has already put. composeFollowUps
    // adds the one being answered itself.
    const alsoAsked = asks.map((a) => a.question).filter((q) => q !== ask.question);

    this.s.followUp = null;
    this.s.proposal = { kind: 'thinking' };
    this.surface.changed();

    const followUpJob = model.composeFollowUps(ask.question, answer, alsoAsked, target).then((questions) => {
      this.s.followUp = questions.length ? { questions, sourceRef: answerRef } : null;
      this.surface.changed();
    });

    const proposalJob = proposalFor(this.app, model, this.host.settings.bankFolder, answer, answerRef).then((offer) => {
      this.s.proposal = offer.kind === 'offer' ? { ...offer, answerRef } : offer;
      this.surface.changed();
    });

    await Promise.all([followUpJob, proposalJob]);
  }

  /** Write one of the offered Follow-ups as an Ask, cited to the answer it came from. */
  async acceptFollowUp(question: string): Promise<void> {
    const offer = this.s.followUp;
    const sitting = this.sitting();
    if (!offer || !sitting) return;
    const line = await insertAsk(this.app, sitting, question, offer.sourceRef);
    this.s.followUp = null;
    this.surface.placeCursor(sitting, line);
    this.surface.changed();
  }

  dismissFollowUp(): void {
    this.s.followUp = null;
    this.surface.changed();
  }

  /** Write the proposed relation, on both ends. Only ever on the owner's word. */
  async acceptProposal(): Promise<void> {
    const state = this.s.proposal;
    if (state.kind !== 'offer') return;
    const target = parseRef(state.proposal.ref);
    if (!target) return;
    await linkBoth(this.app, state.answerRef, state.proposal.relation, target, {
      bankFolder: this.host.settings.bankFolder,
    });
    this.surface.notice(`Linked: ${state.proposal.relation}.`);
    this.s.proposal = { kind: 'idle' };
    this.surface.changed();
  }

  ignoreProposal(): void {
    this.s.proposal = { kind: 'idle' };
    this.surface.changed();
  }
}

const DEFAULT_TEMPLATE = '## Asked\n';

/**
 * Today's Sitting as a file, made from Templates/Sitting.md (verbatim) when
 * today has none. Where an Ask goes when the owner asks about a selection in
 * a note that is not a Sitting.
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

/** Pure: the header line while roaming: what is left in the two jars. */
export function jarsLine(jars: JarCounts): string {
  const q = `${jars.questions} question${jars.questions === 1 ? '' : 's'}`;
  const p = `${jars.paragraphs} paragraph${jars.paragraphs === 1 ? '' : 's'}`;
  const w = `${jars.wells} well${jars.wells === 1 ? '' : 's'}`;
  return `roaming · ${q} · ${p} across ${w}`;
}
