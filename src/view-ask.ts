// The Ask pane: the jars in play (or the Target), one drawn source (a bank
// question, or a paragraph drawn as a Revisit), the open Asks of the active
// Sitting, and a Proposals area (model-dependent).

import { ItemView, MarkdownRenderer, MarkdownView, Notice, moment, setIcon } from 'obsidian';
import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import { answerText, asksOf, insertAsk, markAnswered } from './asks';
import type { Ask, AskOptions } from './asks';
import { draw, parseDue } from './bank';
import type { AnsweredIndex, DrawSource, Drawn, JarCounts } from './bank';
import { ensureBlockId, NotAParagraph } from './blocks';
import { lensFor, lensName } from './lens';
import { linkBoth } from './links';
import type { Model, Proposal, RevisitCandidate } from './model';
import type { Paragraph } from './paragraphs';
import { blockPool } from './pool';
import { formatRef, keyOfRef, parseRef, resolveRef } from './refs';
import type { Ref } from './refs';
import { NotSelectable, selectionParagraph } from './selection';
import type { KeepWritingSettings } from './settings';
import { ME_BASENAME, SELF, allWells, isSitting, readTarget } from './target';
import type { Well } from './target';

export const ASK_VIEW = 'keep-writing-ask';

export interface AskHost {
  app: App;
  settings: KeepWritingSettings;
  index: AnsweredIndex;
  model: Model;
}

const SOURCE_LABEL: Record<DrawSource, string> = {
  target: 'drawn',
  bookmark: 'Bookmark',
  door: 'open door',
};

interface FollowUpOffer {
  /** Up to three candidates, best first. */
  questions: string[];
  /** The answer block the questions came from; the Ask's source. */
  sourceRef: Ref;
}

type ProposalState =
  | { kind: 'idle' }
  | { kind: 'thinking' }
  | { kind: 'none'; reason: string }
  | { kind: 'offer'; answerRef: Ref; proposal: Proposal; candidateText: string };

/**
 * The questions bonsai composed for the drawn paragraph. `key` is the
 * paragraph's, so a reply that lands after a redraw is dropped. `lens` names
 * the Lens the composition read through, when the Well has one. An empty
 * offer shows the one fixed fallback question.
 */
type RevisitState =
  | { kind: 'idle' }
  | { kind: 'composing'; key: string; lens: string | null }
  | { kind: 'offer'; key: string; lens: string | null; candidates: RevisitCandidate[] };

/** The one fixed Revisit form, for when the model is off or offers nothing. A paragraph is never a dead end. */
const REVISIT_FALLBACK = 'what would you write under this now?';

export class AskView extends ItemView {
  private file: TFile | null = null;
  private asks: Ask[] = [];
  private drawn: Drawn | null = null;
  /** What the two jars hold after the last draw: the header's numbers. */
  private jars: JarCounts = { questions: 0, paragraphs: 0, wells: 0 };
  private source: DrawSource = 'target';
  /** Source keys not to draw again this session: skipped, or accepted before the cache caught up. */
  private readonly skipped = new Set<string>();
  private loading = false;
  /** A follow-up bonsai composed from the last marked answer, until accepted or dismissed. */
  private followUp: FollowUpOffer | null = null;
  /** The Proposals area: idle, thinking, one proposal, or nothing found. */
  private proposal: ProposalState = { kind: 'idle' };
  /** Candidate questions for the drawn paragraph, when the draw is a Revisit. */
  private revisit: RevisitState = { kind: 'idle' };
  /** True when the card holds words the owner selected, not a source the draw found. */
  private fromSelection = false;

  constructor(leaf: WorkspaceLeaf, private host: AskHost) {
    super(leaf);
  }

  getViewType(): string {
    return ASK_VIEW;
  }
  getDisplayText(): string {
    return 'Ask';
  }
  override getIcon(): string {
    return 'message-circle-question';
  }

  override async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.track()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.track()));
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        if (f.path === this.file?.path) void this.reloadAsks();
      }),
    );
    await this.track();
  }

  /**
   * Follow the active markdown file; redraw when the Sitting changes.
   *
   * Render only when the file changed, or on the first mount. A click inside
   * this pane makes it the active leaf, so `active-leaf-change` arrives with
   * no markdown view and nothing changed. An unconditional render there
   * empties `contentEl` between mousedown and mouseup; the button under the
   * pointer dies with it and the browser dispatches no click. That is what
   * made the pane need a second click.
   */
  private async track(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file ?? this.file;
    const changed = file?.path !== this.file?.path;
    this.file = file ?? null;
    if (!changed) {
      if (!this.contentEl.hasChildNodes()) this.render();
      return;
    }
    this.drawn = null;
    this.followUp = null;
    this.proposal = { kind: 'idle' };
    this.revisit = { kind: 'idle' };
    this.fromSelection = false;
    await this.reloadAsks();
    if (isSitting(this.file, this.host.settings.sittingsFolder)) await this.redraw('target');
  }

  /**
   * The editor to read the selection from: the active one, or the one still
   * showing the tracked file. A click on this pane has already made the pane
   * the active leaf, so `getActiveViewOfType` alone returns null there.
   */
  private markdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;
    const path = this.file?.path;
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === path) return view;
    }
    return null;
  }

  /**
   * Take the words the owner selected as the source, wherever they are, and
   * compose about them exactly as a Revisit composes about a drawn paragraph.
   * The caller passes the selection when it has one in hand (a command runs
   * with the editor focused); the pane's own button has to go and find it.
   */
  async askAboutSelection(picked?: { file: TFile; selected: string; line: number }): Promise<void> {
    let source = picked;
    if (!source) {
      const view = this.markdownView();
      if (!view?.file) {
        new Notice('Open a note and select the words to ask about.');
        return;
      }
      source = { file: view.file, selected: view.editor.getSelection(), line: view.editor.getCursor('from').line };
    }
    let paragraph: Paragraph;
    try {
      paragraph = selectionParagraph(this.app, source.file, source.selected, source.line, this.host.settings.sittingsFolder);
    } catch (e) {
      new Notice(e instanceof NotSelectable ? e.message : String(e));
      return;
    }
    // The owner asked for this one by hand, so a skip earlier in the session
    // does not stand, and answered-ness does not bar it.
    this.skipped.delete(paragraph.key);
    const well = this.wellNamed(paragraph.wells[0]);
    this.drawn = { source: paragraph, well };
    this.fromSelection = true;
    this.loading = false;
    this.revisit = { kind: 'idle' };
    this.render();
    await this.composeRevisit(paragraph, well);
  }

  /** The Well a paragraph is filed under, for its Lens. The self when the name is not a Well. */
  private wellNamed(name: string | undefined): Well {
    return allWells(this.app).find((w) => w.name === name) ?? SELF;
  }

  private async reloadAsks(): Promise<void> {
    this.asks = isSitting(this.file, this.host.settings.sittingsFolder) ? await asksOf(this.app, this.file) : [];
    this.render();
  }

  /** Draw a fresh question from `source`; the Sitting's existing Asks never come back. */
  async redraw(source: DrawSource = this.source): Promise<void> {
    if (!isSitting(this.file, this.host.settings.sittingsFolder)) return;
    this.source = source;
    this.fromSelection = false;
    const placed = new Set(this.skipped);
    for (const a of this.asks) {
      const ref = parseRef(a.sourceRef);
      const key = ref && keyOfRef(this.app, ref, this.file.path);
      if (key) placed.add(key);
    }
    this.loading = true;
    this.render();
    const { sittingsFolder, bankFolder } = this.host.settings;
    const result = await draw(
      { app: this.app, bankFolder, sittingsFolder, index: this.host.index, skipped: placed, sitting: this.file },
      readTarget(this.app, this.file),
      source,
    );
    this.drawn = result.drawn;
    this.jars = result.jars;
    this.loading = false;
    this.revisit = { kind: 'idle' };
    this.render();
    if (this.drawn?.source.kind === 'paragraph' && this.drawn.well) {
      await this.composeRevisit(this.drawn.source, this.drawn.well);
    }
  }

  /**
   * Ask bonsai for questions about the drawn paragraph, with one line of
   * framing (when and where it was written) and the Well's Lens. Without the
   * model, or when it offers nothing, the offer is empty and the pane shows
   * the fallback.
   */
  private async composeRevisit(paragraph: Paragraph, well: Well): Promise<void> {
    const key = paragraph.key;
    const model = this.host.model;
    const lens = await lensFor(this.app, well);
    const name = lens ? lensName(well) : null;
    if (!model.available) {
      this.revisit = { kind: 'offer', key, lens: name, candidates: [] };
      this.render();
      return;
    }
    this.revisit = { kind: 'composing', key, lens: name };
    this.render();
    const candidates = await model.composeRevisit(paragraph.text, paragraph.framing, lens);
    if (this.drawn?.source.kind !== 'paragraph' || this.drawn.source.key !== key) return;
    this.revisit = { kind: 'offer', key, lens: name, candidates };
    this.render();
  }

  private async accept(): Promise<void> {
    if (!this.drawn || !isSitting(this.file, this.host.settings.sittingsFolder)) return;
    const { source, due } = this.drawn;
    if (source.kind !== 'question') return;
    const file = this.file;
    const line = await insertAsk(this.app, file, source.text, source.ref, due ? { due } : {});
    this.placeCursor(file, line);
    this.skipped.add(source.key);
    await this.redraw('target');
  }

  /**
   * Place a Revisit: the chosen question as the Ask, the paragraph as its
   * source, embedded under the from-line. A paragraph that has no block id
   * yet (a Domain or Learning body) is given one now, so the Ask can cite
   * it. A candidate with `dueDays` sets the Ask's due date.
   */
  private async acceptRevisit(candidate: RevisitCandidate): Promise<void> {
    if (!this.drawn) return;
    const { source } = this.drawn;
    if (source.kind !== 'paragraph') return;
    // An Ask always lands in a Sitting. When the owner picked the paragraph
    // out of a Piece they were reading, that is today's Sitting, made now if
    // today has none yet.
    const folder = this.host.settings.sittingsFolder;
    const sitting = isSitting(this.file, folder) ? this.file : await todaysSitting(this.app, folder);
    let ref = source.ref;
    if (!ref.blockId) {
      try {
        ref = await ensureBlockId(this.app, source.file, source.line);
      } catch (e) {
        new Notice(e instanceof NotAParagraph ? e.message : String(e));
        return;
      }
    }
    const opts: AskOptions = { embed: true };
    const due = candidate.dueDays !== undefined ? parseDue(`+${candidate.dueDays}d`, new Date()) : null;
    if (due) opts.due = due;
    const line = await insertAsk(this.app, sitting, candidate.question, ref, opts);
    this.skipped.add(source.key);
    if (sitting.path === this.file?.path) {
      this.placeCursor(sitting, line);
      await this.redraw('target');
      return;
    }
    new Notice(`Asked in ${sitting.basename}.`);
    this.drawn = null;
    this.fromSelection = false;
    this.revisit = { kind: 'idle' };
    this.render();
  }

  private skip(): void {
    if (this.drawn) this.skipped.add(this.drawn.source.key);
    void this.redraw();
  }

  private async mark(ask: Ask): Promise<void> {
    if (!this.file) return;
    const answerRef = await markAnswered(this.app, this.file, ask, { bankFolder: this.host.settings.bankFolder });
    if (!answerRef) return;
    new Notice('Answer linked.');
    await this.afterAnswer(this.file, answerRef, ask);
  }

  /**
   * After an answer is marked: ask bonsai for follow-ups, given the question
   * and the whole answer, and for one Proposal against the blocks code finds
   * lexically. Both may come back empty; the pane then shows the bank draw
   * and "nothing found".
   */
  async afterAnswer(file: TFile, answerRef: Ref, ask: Ask): Promise<void> {
    const model = this.host.model;
    if (!model.available) return;
    const answer = answerText(await this.app.vault.cachedRead(file), ask);
    if (!answer) return;
    const target = readTarget(this.app, file)?.name ?? ME_BASENAME;

    this.followUp = null;
    this.proposal = { kind: 'thinking' };
    this.render();

    const followUpJob = model.composeFollowUps(ask.question, answer, target).then((questions) => {
      this.followUp = questions.length ? { questions, sourceRef: answerRef } : null;
      this.render();
    });

    const proposalJob = (async () => {
      const pool = await blockPool(this.app, this.host.settings.bankFolder);
      const candidates = model.findCandidates(answer, pool, 5, formatRef(answerRef));
      if (candidates.length === 0) {
        this.proposal = { kind: 'none', reason: 'no earlier block shares words with this answer' };
        this.render();
        return;
      }
      const proposal = await model.proposeRelation(answer, candidates);
      const candidateText = candidates.find((c) => c.ref === proposal?.ref)?.text ?? '';
      this.proposal = proposal
        ? { kind: 'offer', answerRef, proposal, candidateText }
        : { kind: 'none', reason: 'the model found no relation, or its quote did not check out' };
      this.render();
    })();

    await Promise.all([followUpJob, proposalJob]);
  }

  private async acceptFollowUp(question: string): Promise<void> {
    const offer = this.followUp;
    if (!offer || !isSitting(this.file, this.host.settings.sittingsFolder)) return;
    const file = this.file;
    const line = await insertAsk(this.app, file, question, offer.sourceRef);
    this.followUp = null;
    this.placeCursor(file, line);
    this.render();
  }

  private async acceptProposal(): Promise<void> {
    const state = this.proposal;
    if (state.kind !== 'offer') return;
    const target = parseRef(state.proposal.ref);
    if (!target) return;
    await linkBoth(this.app, state.answerRef, state.proposal.relation, target, {
      bankFolder: this.host.settings.bankFolder,
    });
    new Notice(`Linked: ${state.proposal.relation}.`);
    this.proposal = { kind: 'idle' };
    this.render();
  }

  private placeCursor(file: TFile, line: number): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file?.path === file.path) {
      view.editor.setCursor({ line, ch: 0 });
      view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
      view.editor.focus();
    }
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('kw-ask');

    if (!isSitting(this.file, this.host.settings.sittingsFolder)) {
      root.createEl('p', { text: 'The active note is not a Sitting.', cls: 'kw-muted' });
      const bar = root.createDiv({ cls: 'kw-buttons' });
      const btn = bar.createEl('button', { text: 'Open today’s Sitting', cls: 'mod-cta' });
      btn.addEventListener('click', () => void openTodaysSitting(this.app, this.host.settings.sittingsFolder));
      this.addSelectionButton(bar);
      // A selection made in this note still shows its card here. The Ask it
      // becomes goes to today's Sitting, not into what is being read.
      if (this.fromSelection && this.file) this.renderQuestion(root, this.file);
      return;
    }
    const file = this.file;

    const target = readTarget(this.app, file);
    const head = root.createDiv({ cls: 'kw-target kw-small' });
    if (target) {
      head.createSpan({ text: 'only ', cls: 'kw-muted' });
      const a = head.createEl('a', { text: target.name, cls: 'internal-link' });
      const path = target.file?.path ?? `${ME_BASENAME}.md`;
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(path, file.path);
      });
      head.createSpan({ text: ' (remove `about` to roam)', cls: 'kw-muted' });
    } else {
      head.createSpan({ text: this.loading ? 'roaming' : jarsLine(this.jars), cls: 'kw-muted' });
    }

    this.addSelectionButton(root.createDiv({ cls: 'kw-buttons' }));
    this.renderFollowUp(root, file);
    this.renderQuestion(root, file);
    this.renderOpenAsks(root);
    this.renderProposals(root, file);
  }

  /** Always offered: the owner points at their own words instead of waiting for a draw. */
  private addSelectionButton(bar: HTMLElement): void {
    const btn = bar.createEl('button', { text: 'Ask about selection' });
    btn.addEventListener('click', () => void this.askAboutSelection());
  }

  private renderFollowUp(root: HTMLElement, file: TFile): void {
    const offer = this.followUp;
    if (!offer) return;
    const card = root.createDiv({ cls: 'kw-card kw-follow-up' });
    const head = card.createDiv({ cls: 'kw-muted kw-small' });
    head.createSpan({ text: 'follow-ups on ' });
    const src = head.createEl('a', { text: 'this answer', cls: 'internal-link' });
    src.addEventListener('click', (ev) => {
      ev.preventDefault();
      void this.app.workspace.openLinkText(formatRef(offer.sourceRef), file.path, ev.ctrlKey || ev.metaKey);
    });
    for (const question of offer.questions) {
      const row = card.createDiv({ cls: 'kw-row kw-candidate-q' });
      const text = row.createDiv({ cls: 'kw-ref kw-question' });
      void MarkdownRenderer.render(this.app, question, text, file.path, this);
      const btn = row.createEl('button', { cls: 'kw-mark clickable-icon', attr: { 'aria-label': 'Ask this' } });
      setIcon(btn, 'plus');
      btn.addEventListener('click', () => void this.acceptFollowUp(question));
    }
    const bar = card.createDiv({ cls: 'kw-buttons' });
    bar.createEl('button', { text: 'Dismiss' }).addEventListener('click', () => {
      this.followUp = null;
      this.render();
    });
  }

  private renderProposals(root: HTMLElement, file: TFile): void {
    const section = root.createDiv({ cls: 'kw-section' });
    section.createEl('div', { text: 'Proposals', cls: 'kw-group-name' });
    const model = this.host.model;
    if (!model.available) {
      section.createEl('p', { text: model.reason, cls: 'kw-muted' });
      return;
    }
    const state = this.proposal;
    switch (state.kind) {
      case 'idle':
        section.createEl('p', { text: 'Mark an answer done and the model looks for a relation to an earlier block.', cls: 'kw-muted' });
        return;
      case 'thinking':
        section.createEl('p', { text: 'Reading earlier blocks…', cls: 'kw-muted' });
        return;
      case 'none':
        section.createEl('p', { text: `Nothing proposed: ${state.reason}.`, cls: 'kw-muted' });
        return;
      case 'offer': {
        const card = section.createDiv({ cls: 'kw-card' });
        const head = card.createDiv({ cls: 'kw-small' });
        head.createSpan({ text: 'this answer ', cls: 'kw-muted' });
        head.createEl('strong', { text: state.proposal.relation });
        head.createSpan({ text: ' ', cls: 'kw-muted' });
        const ref = parseRef(state.proposal.ref);
        const resolved = ref && resolveRef(this.app, ref, file.path);
        const a = head.createEl('a', { text: resolved ? resolved.file.basename : state.proposal.ref, cls: 'internal-link' });
        a.addEventListener('click', (ev) => {
          ev.preventDefault();
          void this.app.workspace.openLinkText(state.proposal.ref, file.path, ev.ctrlKey || ev.metaKey);
        });
        const body = card.createDiv({ cls: 'kw-candidate' });
        void MarkdownRenderer.render(this.app, state.candidateText, body, file.path, this);
        card.createDiv({ text: `“${state.proposal.quote}”`, cls: 'kw-quote kw-small' });
        const bar = card.createDiv({ cls: 'kw-buttons' });
        bar.createEl('button', { text: 'Link', cls: 'mod-cta' }).addEventListener('click', () => void this.acceptProposal());
        bar.createEl('button', { text: 'Ignore' }).addEventListener('click', () => {
          this.proposal = { kind: 'idle' };
          this.render();
        });
        return;
      }
    }
  }

  private renderQuestion(root: HTMLElement, file: TFile): void {
    const card = root.createDiv({ cls: 'kw-card' });
    const revisit = !this.loading && this.drawn?.source.kind === 'paragraph';
    const label = this.fromSelection ? 'your selection' : revisit ? 'revisit' : SOURCE_LABEL[this.source];
    card.createEl('div', { text: label, cls: 'kw-muted kw-small' });
    if (this.loading) {
      card.createEl('p', { text: 'Drawing…', cls: 'kw-muted' });
    } else if (!this.drawn) {
      card.createEl('p', { text: 'Nothing left to draw here. Every source is answered, skipped or already asked.', cls: 'kw-muted' });
    } else if (this.drawn.source.kind === 'paragraph') {
      this.renderParagraph(card, file, this.drawn.source);
    } else {
      const source = this.drawn.source;
      const q = card.createDiv({ cls: 'kw-question' });
      void MarkdownRenderer.render(this.app, source.text, q, file.path, this);
      const meta = card.createDiv({ cls: 'kw-meta kw-small' });
      const src = meta.createEl('a', { text: formatRef(source.ref), cls: 'internal-link' });
      src.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(formatRef(source.ref), file.path, ev.ctrlKey || ev.metaKey);
      });
      meta.createSpan({ text: ` · ${source.register}`, cls: 'kw-muted' });
      if (this.drawn.due) meta.createSpan({ text: ` · due ${this.drawn.due}`, cls: 'kw-muted' });
    }

    const bar = card.createDiv({ cls: 'kw-buttons' });
    if (this.fromSelection) {
      // A selection is not the draw's to move on from: there is no next one.
      bar.createEl('button', { text: 'Dismiss' }).addEventListener('click', () => {
        this.drawn = null;
        this.fromSelection = false;
        this.revisit = { kind: 'idle' };
        this.render();
      });
      return;
    }
    if (!revisit) {
      const accept = bar.createEl('button', { text: 'Accept', cls: 'mod-cta' });
      accept.disabled = !this.drawn || this.loading;
      accept.addEventListener('click', () => void this.accept());
    }
    const skip = bar.createEl('button', { text: 'Skip' });
    skip.disabled = !this.drawn || this.loading;
    skip.addEventListener('click', () => this.skip());
    bar.createEl('button', { text: 'Bookmark' }).addEventListener('click', () => void this.redraw('bookmark'));
    bar.createEl('button', { text: 'Open door' }).addEventListener('click', () => void this.redraw('door'));
    if (this.source !== 'target') {
      bar.createEl('button', { text: 'Back to bank' }).addEventListener('click', () => void this.redraw('target'));
    }
  }

  /**
   * A paragraph drawn as a Revisit: the paragraph itself, one line of framing
   * (title · date · publisher, and the Lens it is read through), then the
   * questions bonsai composed, each with a +. While it composes, say so.
   * With nothing composed, the one fixed fallback question, so the paragraph
   * is never a dead end.
   */
  private renderParagraph(card: HTMLElement, file: TFile, paragraph: Paragraph): void {
    const body = card.createDiv({ cls: 'kw-paragraph' });
    void MarkdownRenderer.render(this.app, paragraph.text, body, file.path, this);

    const state = this.revisit;
    const current = state.kind !== 'idle' && state.key === paragraph.key;

    const framing = card.createDiv({ cls: 'kw-meta kw-small' });
    const title = framing.createEl('a', { text: paragraph.title, cls: 'internal-link' });
    title.addEventListener('click', (ev) => {
      ev.preventDefault();
      void this.app.workspace.openLinkText(formatRef(paragraph.ref), file.path, ev.ctrlKey || ev.metaKey);
    });
    for (const part of paragraph.meta) framing.createSpan({ text: ` · ${part}`, cls: 'kw-muted' });
    if (current && state.lens) framing.createSpan({ text: ` · through the ${state.lens} lens`, cls: 'kw-muted' });

    if (state.kind !== 'offer' || !current) {
      card.createEl('p', { text: 'Composing…', cls: 'kw-muted' });
      return;
    }
    if (state.candidates.length === 0) {
      const bar = card.createDiv({ cls: 'kw-buttons' });
      const btn = bar.createEl('button', { text: `Ask: ${REVISIT_FALLBACK}`, cls: 'mod-cta' });
      btn.addEventListener('click', () => void this.acceptRevisit({ question: REVISIT_FALLBACK }));
      return;
    }
    for (const candidate of state.candidates) {
      const row = card.createDiv({ cls: 'kw-row kw-candidate-q' });
      const text = row.createDiv({ cls: 'kw-ref kw-question' });
      void MarkdownRenderer.render(this.app, candidate.question, text, file.path, this);
      if (candidate.dueDays !== undefined) text.createSpan({ text: ` · due in ${candidate.dueDays} days`, cls: 'kw-muted kw-small' });
      const btn = row.createEl('button', { cls: 'kw-mark clickable-icon', attr: { 'aria-label': 'Ask this' } });
      setIcon(btn, 'plus');
      btn.addEventListener('click', () => void this.acceptRevisit(candidate));
    }
  }

  private renderOpenAsks(root: HTMLElement): void {
    const open = this.asks.filter((a) => !a.answered);
    const section = root.createDiv({ cls: 'kw-section' });
    section.createEl('div', { text: `Open Asks (${open.length})`, cls: 'kw-group-name' });
    if (open.length === 0) {
      section.createEl('p', { text: 'No open Asks in this Sitting.', cls: 'kw-muted' });
      return;
    }
    for (const ask of open) {
      const row = section.createDiv({ cls: 'kw-row' });
      const text = row.createSpan({ text: ask.question, cls: 'kw-ref' });
      text.addEventListener('click', () => this.jumpTo(ask.callout.start));
      if (!ask.sourceRef) row.createSpan({ text: ' (no source)', cls: 'kw-muted kw-small' });
      const btn = row.createEl('button', { cls: 'kw-mark clickable-icon', attr: { 'aria-label': 'Mark answered' } });
      setIcon(btn, ask.firstParagraph ? 'check' : 'circle-dashed');
      btn.addEventListener('click', () => void this.mark(ask));
    }
  }

  private jumpTo(line: number): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file?.path !== this.file?.path) return;
    view.editor.setCursor({ line, ch: 0 });
    view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
  }
}

/** Pure: the header line while roaming: what is left in the two jars. */
export function jarsLine(jars: JarCounts): string {
  const q = `${jars.questions} question${jars.questions === 1 ? '' : 's'}`;
  const p = `${jars.paragraphs} paragraph${jars.paragraphs === 1 ? '' : 's'}`;
  const w = `${jars.wells} well${jars.wells === 1 ? '' : 's'}`;
  return `roaming · ${q} · ${p} across ${w}`;
}

const DEFAULT_TEMPLATE = '## Asked\n';

/**
 * Open today's Sitting through the daily-notes core plugin. If its command is
 * absent, create the note from Templates/Sitting.md (verbatim) and open it.
 */
export async function openTodaysSitting(app: App, sittingsFolder: string): Promise<void> {
  const commands = (app as unknown as { commands?: { executeCommandById(id: string): boolean } }).commands;
  if (commands?.executeCommandById('daily-notes')) return;
  const file = await todaysSitting(app, sittingsFolder);
  await app.workspace.getLeaf(false).openFile(file);
}

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
