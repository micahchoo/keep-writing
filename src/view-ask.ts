// The Ask pane: the jars in play (or the Target), one drawn source (a bank
// question, or a paragraph drawn as a Revisit), the open Asks of the active
// Sitting, and a Proposals area (model-dependent).
//
// The pane DRAWS the Interview (interview.ts) and nothing else. It holds no
// state of its own and it owns no Interview either: the plugin owns the one
// Interview and hands it here, so two panes draw one Sitting's worth of it.
// Reading the editor's selection is the only vault work left here, because
// only a pane knows which editor the owner is looking at.

import { ItemView, MarkdownRenderer, MarkdownView, Notice, setIcon } from 'obsidian';
import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import type { DrawSource } from './bank';
import type { Paragraph } from './paragraphs';
import { formatRef, parseRef, resolveRef } from './refs';
import { REVISIT_FALLBACK, jarsLine, todaysSitting } from './interview';
import type { Interview, InterviewHost, InterviewState } from './interview';
import { ME_BASENAME } from './target';

export const ASK_VIEW = 'keep-writing-ask';

/** The plugin: what the Interview reads the vault through, and the Interview itself. */
export interface AskHost extends InterviewHost {
  interview: Interview;
}

const SOURCE_LABEL: Record<DrawSource, string> = {
  target: 'drawn',
  bookmark: 'Bookmark',
  door: 'open door',
};

export class AskView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private host: AskHost) {
    super(leaf);
  }

  private get interview(): Interview {
    return this.host.interview;
  }

  private get s(): Readonly<InterviewState> {
    return this.interview.state;
  }

  /** The Interview's state changed; draw it. The plugin's Surface calls this. */
  refresh(): void {
    this.render();
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
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => void this.track()));
    this.registerEvent(this.app.workspace.on('file-open', () => void this.track()));
    await this.track();
  }

  /**
   * Follow the active markdown file. The Interview says whether anything
   * changed; render otherwise only to fill an empty pane.
   *
   * A click inside this pane makes it the active leaf, so `active-leaf-change`
   * arrives with no markdown view and nothing changed. An unconditional render
   * there empties `contentEl` between mousedown and mouseup; the button under
   * the pointer dies with it and the browser dispatches no click. That is what
   * made the pane need a second click.
   */
  private async track(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const changed = await this.interview.track(view?.file ?? null);
    if (!changed && !this.contentEl.hasChildNodes()) this.render();
  }

  /**
   * The editor to read the selection from: the active one, or the one still
   * showing the tracked file. A click on this pane has already made the pane
   * the active leaf, so `getActiveViewOfType` alone returns null there.
   */
  private markdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;
    const path = this.s.file?.path;
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === path) return view;
    }
    return null;
  }

  /**
   * Hand the Interview the words the owner selected. The pane's own button has
   * to go and find them; a command reads the editor itself, while it still
   * holds the focus, and hands them to the Interview directly.
   */
  private async askAboutSelection(): Promise<void> {
    const view = this.markdownView();
    if (!view?.file) {
      new Notice('Open a note and select the words to ask about.');
      return;
    }
    await this.interview.askAbout({
      file: view.file,
      selected: view.editor.getSelection(),
      line: view.editor.getCursor('from').line,
    });
  }

  // -------------------------------------------------------------------------
  // Drawing the state

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('kw-ask');

    const file = this.s.file;
    if (!this.s.inSitting || !file) {
      root.createEl('p', { text: 'The active note is not a Sitting.', cls: 'kw-muted' });
      const bar = root.createDiv({ cls: 'kw-buttons' });
      const btn = bar.createEl('button', { text: 'Open today’s Sitting', cls: 'mod-cta' });
      btn.addEventListener('click', () => void openTodaysSitting(this.app, this.host.settings.sittingsFolder));
      this.addSelectionButton(bar);
      // A selection made in this note still shows its card here. The Ask it
      // becomes goes to today's Sitting, not into what is being read.
      if (this.s.fromSelection && file) this.renderQuestion(root, file);
      return;
    }

    const target = this.s.target;
    const head = root.createDiv({ cls: 'kw-target kw-small' });
    if (target) {
      head.createSpan({ text: 'only ', cls: 'kw-muted' });
      this.linkTo(head, target.name, target.file?.path ?? `${ME_BASENAME}.md`, file.path);
      head.createSpan({ text: ' (remove `about` to roam)', cls: 'kw-muted' });
    } else {
      head.createSpan({ text: this.s.loading ? 'roaming' : jarsLine(this.s.jars), cls: 'kw-muted' });
    }

    this.addSelectionButton(root.createDiv({ cls: 'kw-buttons' }));
    this.renderFollowUp(root, file);
    this.renderQuestion(root, file);
    this.renderOpenAsks(root);
    this.renderProposals(root, file);
  }

  /**
   * An internal link that opens in the vault. Every ref the pane shows is one
   * of these, so ctrl/cmd-click-for-a-new-pane is written once.
   */
  private linkTo(parent: HTMLElement, text: string, linkText: string, from: string): HTMLElement {
    const a = parent.createEl('a', { text, cls: 'internal-link' });
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      void this.app.workspace.openLinkText(linkText, from, ev.ctrlKey || ev.metaKey);
    });
    return a;
  }

  /** A question with a + beside it: the shape of every candidate the pane offers. */
  private renderCandidate(card: HTMLElement, question: string, from: string, ask: () => void): HTMLElement {
    const row = card.createDiv({ cls: 'kw-row kw-candidate-q' });
    const text = row.createDiv({ cls: 'kw-ref kw-question' });
    void MarkdownRenderer.render(this.app, question, text, from, this);
    const btn = row.createEl('button', { cls: 'kw-mark clickable-icon', attr: { 'aria-label': 'Ask this' } });
    setIcon(btn, 'plus');
    btn.addEventListener('click', ask);
    return text;
  }

  /** Always offered: the owner points at their own words instead of waiting for a draw. */
  private addSelectionButton(bar: HTMLElement): void {
    const btn = bar.createEl('button', { text: 'Ask about selection' });
    btn.addEventListener('click', () => void this.askAboutSelection());
  }

  private renderFollowUp(root: HTMLElement, file: TFile): void {
    const offer = this.s.followUp;
    if (!offer) return;
    const card = root.createDiv({ cls: 'kw-card kw-follow-up' });
    const head = card.createDiv({ cls: 'kw-muted kw-small' });
    head.createSpan({ text: 'follow-ups on ' });
    this.linkTo(head, 'this answer', formatRef(offer.sourceRef), file.path);
    for (const question of offer.questions) {
      this.renderCandidate(card, question, file.path, () => void this.interview.acceptFollowUp(question));
    }
    const bar = card.createDiv({ cls: 'kw-buttons' });
    bar.createEl('button', { text: 'Dismiss' }).addEventListener('click', () => this.interview.dismissFollowUp());
  }

  private renderProposals(root: HTMLElement, file: TFile): void {
    const section = root.createDiv({ cls: 'kw-section' });
    section.createEl('div', { text: 'Proposals', cls: 'kw-group-name' });
    const { model } = this.host;
    if (!model.available) {
      section.createEl('p', { text: model.reason, cls: 'kw-muted' });
      return;
    }
    const state = this.s.proposal;
    switch (state.kind) {
      case 'idle':
        section.createEl('p', {
          text: 'Mark an answer done and the model looks for a relation to an earlier block.',
          cls: 'kw-muted',
        });
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
        this.linkTo(head, resolved ? resolved.file.basename : state.proposal.ref, state.proposal.ref, file.path);
        const body = card.createDiv({ cls: 'kw-candidate' });
        void MarkdownRenderer.render(this.app, state.candidateText, body, file.path, this);
        card.createDiv({ text: `“${state.proposal.quote}”`, cls: 'kw-quote kw-small' });
        const bar = card.createDiv({ cls: 'kw-buttons' });
        bar
          .createEl('button', { text: 'Link', cls: 'mod-cta' })
          .addEventListener('click', () => void this.interview.acceptProposal());
        bar.createEl('button', { text: 'Ignore' }).addEventListener('click', () => this.interview.ignoreProposal());
        return;
      }
    }
  }

  private renderQuestion(root: HTMLElement, file: TFile): void {
    const { drawn, loading, fromSelection } = this.s;
    const card = root.createDiv({ cls: 'kw-card' });
    const revisit = !loading && drawn?.source.kind === 'paragraph';
    const label = fromSelection ? 'your selection' : revisit ? 'revisit' : SOURCE_LABEL[this.s.source];
    card.createEl('div', { text: label, cls: 'kw-muted kw-small' });

    if (loading) {
      card.createEl('p', { text: 'Drawing…', cls: 'kw-muted' });
    } else if (!drawn) {
      card.createEl('p', {
        text: 'Nothing left to draw here. Every source is answered, skipped or already asked.',
        cls: 'kw-muted',
      });
    } else if (drawn.source.kind === 'paragraph') {
      this.renderParagraph(card, file, drawn.source);
    } else {
      const source = drawn.source;
      const q = card.createDiv({ cls: 'kw-question' });
      void MarkdownRenderer.render(this.app, source.text, q, file.path, this);
      const meta = card.createDiv({ cls: 'kw-meta kw-small' });
      this.linkTo(meta, formatRef(source.ref), formatRef(source.ref), file.path);
      meta.createSpan({ text: ` · ${source.register}`, cls: 'kw-muted' });
      if (drawn.due) meta.createSpan({ text: ` · due ${drawn.due}`, cls: 'kw-muted' });
    }

    const bar = card.createDiv({ cls: 'kw-buttons' });
    if (fromSelection) {
      // A selection is not the draw's to move on from: there is no next one.
      bar.createEl('button', { text: 'Dismiss' }).addEventListener('click', () => this.interview.dismissSelection());
      return;
    }
    if (!revisit) {
      const accept = bar.createEl('button', { text: 'Accept', cls: 'mod-cta' });
      accept.disabled = !drawn || loading;
      accept.addEventListener('click', () => void this.interview.accept());
    }
    const skip = bar.createEl('button', { text: 'Skip' });
    skip.disabled = !drawn || loading;
    skip.addEventListener('click', () => this.interview.skip());
    bar.createEl('button', { text: 'Bookmark' }).addEventListener('click', () => void this.interview.redraw('bookmark'));
    bar.createEl('button', { text: 'Open door' }).addEventListener('click', () => void this.interview.redraw('door'));
    if (this.s.source !== 'target') {
      bar
        .createEl('button', { text: 'Back to bank' })
        .addEventListener('click', () => void this.interview.redraw('target'));
    }
  }

  /**
   * A paragraph drawn as a Revisit: the paragraph itself, one line of framing
   * (title, date, publisher, and the Lens it is read through), then the
   * questions bonsai composed, each with a +. While it composes, say so.
   * With nothing composed, the one fixed fallback question, so the paragraph
   * is never a dead end.
   */
  private renderParagraph(card: HTMLElement, file: TFile, paragraph: Paragraph): void {
    const body = card.createDiv({ cls: 'kw-paragraph' });
    void MarkdownRenderer.render(this.app, paragraph.text, body, file.path, this);

    const state = this.s.revisit;
    const current = state.kind !== 'idle' && state.key === paragraph.key;

    const framing = card.createDiv({ cls: 'kw-meta kw-small' });
    this.linkTo(framing, paragraph.title, formatRef(paragraph.ref), file.path);
    for (const part of paragraph.meta) framing.createSpan({ text: ` · ${part}`, cls: 'kw-muted' });
    if (current && state.lens) framing.createSpan({ text: ` · through the ${state.lens} lens`, cls: 'kw-muted' });

    if (state.kind !== 'offer' || !current) {
      card.createEl('p', { text: 'Composing…', cls: 'kw-muted' });
      return;
    }
    if (state.candidates.length === 0) {
      const bar = card.createDiv({ cls: 'kw-buttons' });
      const btn = bar.createEl('button', { text: `Ask: ${REVISIT_FALLBACK}`, cls: 'mod-cta' });
      btn.addEventListener('click', () => void this.interview.acceptRevisit({ question: REVISIT_FALLBACK }));
      return;
    }
    for (const candidate of state.candidates) {
      const text = this.renderCandidate(card, candidate.question, file.path, () => {
        void this.interview.acceptRevisit(candidate);
      });
      if (candidate.dueDays !== undefined) {
        text.createSpan({ text: ` · due in ${candidate.dueDays} days`, cls: 'kw-muted kw-small' });
      }
    }
  }

  private renderOpenAsks(root: HTMLElement): void {
    const open = this.s.asks.filter((a) => !a.answered);
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
      btn.addEventListener('click', () => void this.interview.mark(ask));
    }
  }

  private jumpTo(line: number): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file?.path !== this.s.file?.path) return;
    view.editor.setCursor({ line, ch: 0 });
    view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
  }
}

/**
 * Open today's Sitting through the daily-notes core plugin. If its command is
 * absent, create the note from Templates/Sitting.md (verbatim) and open it.
 */
async function openTodaysSitting(app: App, sittingsFolder: string): Promise<void> {
  const commands = (app as unknown as { commands?: { executeCommandById(id: string): boolean } }).commands;
  if (commands?.executeCommandById('daily-notes')) return;
  const file = await todaysSitting(app, sittingsFolder);
  await app.workspace.getLeaf(false).openFile(file);
}
