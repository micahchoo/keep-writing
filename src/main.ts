// keep-writing: the vault interviews its owner. See CONTEXT.md.
//
// Write surface, whole: frontmatter properties (processFrontMatter), a block
// id appended to a paragraph (blocks.ts), and `> [!ask]` callouts (asks.ts).
//
// Read surface: none of its own. There were two ItemViews until 2026-09-17 —
// one drawing the offers, one drawing the typed links of a note. Obsidian
// already draws the second (the backlinks pane, the properties sidebar), and
// the first only ever showed an offer the owner was about to answer, which is
// what a modal is for. What is left is commands.

import { MarkdownView, Notice, Plugin } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { AnsweredIndex } from './bank';
import type { Drawn } from './bank';
import { Interview, REVISIT_FALLBACK, jarsLine } from './interview';
import { linkParagraphCommand } from './link-command';
import { createModel } from './model';
import type { Model, RevisitCandidate } from './model';
import { choose } from './modals';
import type { Choice } from './modals';
import type { Paragraph } from './paragraphs';
import { formatRef } from './refs';
import { DEFAULT_SETTINGS, KeepWritingSettingTab } from './settings';
import type { KeepWritingSettings } from './settings';

/** Longest a drawn paragraph reads in the chooser before it is cut. */
const TITLE_MAX = 120;

export default class KeepWritingPlugin extends Plugin {
  override settings: KeepWritingSettings = { ...DEFAULT_SETTINGS };
  index!: AnsweredIndex;
  model!: Model;
  interview!: Interview;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new AnsweredIndex(this.app);
    this.model = this.buildModel();
    this.interview = new Interview(this, {
      placeCursor: (file, line) => placeCursor(this.app, file, line),
      notice: (message) => {
        new Notice(message);
      },
    });

    // A note changed: answered-ness may have. Nothing else here follows the
    // owner around any more, because nothing is drawn until they ask for it.
    this.registerEvent(this.app.metadataCache.on('changed', () => this.index.invalidate()));
    this.registerEvent(this.app.metadataCache.on('deleted', () => this.index.invalidate()));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.index.invalidate()));

    this.addRibbonIcon('message-circle-question', 'Draw a question', () => void this.drawQuestion());

    this.addCommand({ id: 'draw-question', name: 'Draw a question', callback: () => void this.drawQuestion() });
    this.addCommand({
      id: 'ask-closing-question',
      name: 'Ask a closing question',
      callback: () => void this.askClosing('door'),
    });
    this.addCommand({
      id: 'ask-bookmark-question',
      name: 'Ask the bookmark question',
      callback: () => void this.askClosing('bookmark'),
    });
    this.addCommand({
      id: 'mark-answer-under-cursor',
      name: 'Mark answer under cursor as done',
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) void this.markUnderCursor(view, editor.getCursor().line);
      },
    });
    this.addCommand({
      id: 'ask-about-selection',
      name: 'Ask about the selection',
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) {
          void this.askAboutSelection(view, editor.getSelection(), editor.getCursor('from').line);
        }
      },
    });
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        if (!(view instanceof MarkdownView) || !editor.getSelection().trim()) return;
        const selected = editor.getSelection();
        const line = editor.getCursor('from').line;
        menu.addItem((item) =>
          item
            .setTitle('Ask about the selection')
            .setIcon('message-circle-question')
            .onClick(() => void this.askAboutSelection(view, selected, line)),
        );
      }),
    );
    this.addCommand({
      id: 'link-paragraph',
      name: 'Link this paragraph to…',
      editorCallback: (_editor, view) => {
        if (view instanceof MarkdownView) void linkParagraphCommand(this.app, view, this.settings.bankFolder);
      },
    });

    this.addSettingTab(new KeepWritingSettingTab(this.app, this));
  }

  // -------------------------------------------------------------------------
  // The commands

  /**
   * Draw several sources and let the owner pick one. A Bank question becomes
   * an Ask at once; a paragraph goes to bonsai first, and its questions are the
   * second chooser.
   */
  private async drawQuestion(): Promise<void> {
    const sitting = await this.openSitting();
    const { drawn, jars, target } = await this.interview.draw(sitting);
    if (drawn.length === 0) {
      new Notice('Nothing left to draw. Every source here is answered or already asked.');
      return;
    }
    const where = target ? `only ${target}` : jarsLine(jars);
    choose(this.app, drawn.map(drawnChoice), where, (pick) => {
      if (pick.source.kind === 'question') void this.interview.accept(sitting, pick);
      else void this.offerRevisit(sitting, pick.source);
    });
  }

  /** One closing move, written straight in: there is nothing to choose between. */
  private async askClosing(role: 'door' | 'bookmark'): Promise<void> {
    const sitting = await this.openSitting();
    const drawn = await this.interview.closing(sitting, role);
    if (!drawn) {
      new Notice('No closing question left to ask.');
      return;
    }
    await this.interview.accept(sitting, drawn);
  }

  /**
   * Hand the Interview the words the owner selected. Read here, where the
   * editor still holds the focus.
   */
  private async askAboutSelection(view: MarkdownView, selected: string, line: number): Promise<void> {
    const file = view.file;
    if (!file) return;
    const paragraph = this.interview.selection({ file, selected, line });
    if (!paragraph) return;
    await this.offerRevisit(await this.interview.sitting(file), paragraph);
  }

  /** bonsai's questions about a paragraph, as the second chooser. */
  private async offerRevisit(sitting: TFile, paragraph: Paragraph): Promise<void> {
    const notice = new Notice('Composing…', 0);
    let offer;
    try {
      offer = await this.interview.revisitOffer(paragraph);
    } finally {
      notice.hide();
    }
    const lens = offer.lens ? ` · through the ${offer.lens} lens` : '';
    // A paragraph is never a dead end: with nothing composed, the one fixed form.
    const candidates: RevisitCandidate[] = offer.candidates.length
      ? offer.candidates
      : [{ question: REVISIT_FALLBACK }];
    choose(
      this.app,
      candidates.map((c) => revisitChoice(c)),
      `${paragraph.title}${lens}`,
      (candidate) => void this.interview.acceptRevisit(sitting, paragraph, candidate),
    );
  }

  /**
   * Mark the answer the cursor is in, then offer whatever bonsai found in it.
   * The note and the line are read here, while the editor still holds focus.
   */
  private async markUnderCursor(view: MarkdownView, line: number): Promise<void> {
    const file = view.file;
    if (!file) return;
    const answered = await this.interview.markAt({ file, line });
    if (!answered || answered.questions.length === 0) return;
    choose(
      this.app,
      answered.questions.map((q) => ({ value: q, title: q })),
      'follow up on this answer',
      (question) => void this.interview.acceptFollowUp(file, question, answered.ref),
    );
  }

  // -------------------------------------------------------------------------

  /**
   * The Sitting the owner is in, opened and active, so the cursor can land in
   * it. Today's when they are reading something else.
   */
  private async openSitting(): Promise<TFile> {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
    const sitting = await this.interview.sitting(active);
    if (sitting.path !== active?.path) await this.app.workspace.getLeaf(false).openFile(sitting);
    return sitting;
  }

  private buildModel(): Model {
    return createModel(this.settings, (e) => console.debug('[keep-writing]', e));
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<KeepWritingSettings> | null) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.model = this.buildModel();
  }
}

/** Pure: one drawn source as a row — what it says, and where it comes from. */
export function drawnChoice(drawn: Drawn): Choice<Drawn> {
  if (drawn.source.kind === 'question') {
    const parts = [drawn.source.register, formatRef(drawn.source.ref)];
    if (drawn.due) parts.push(`due ${drawn.due}`);
    return { value: drawn, title: drawn.source.text, note: parts.join(' · ') };
  }
  const { text, title, meta } = drawn.source;
  return { value: drawn, title: cut(text), note: ['revisit', title, ...meta].join(' · ') };
}

/** Pure: one composed question as a row, with its due marker when it has one. */
export function revisitChoice(candidate: RevisitCandidate): Choice<RevisitCandidate> {
  const row: Choice<RevisitCandidate> = { value: candidate, title: candidate.question };
  if (candidate.dueDays !== undefined) row.note = `due in ${candidate.dueDays} days`;
  return row;
}

/** Pure: a paragraph shortened to one readable row. */
export function cut(text: string, max: number = TITLE_MAX): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Put the cursor at a line of a note. False when the owner is looking at
 * something else, so the caller can say where the Ask landed instead.
 */
function placeCursor(app: App, file: TFile, line: number): boolean {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (view?.file?.path !== file.path) return false;
  view.editor.setCursor({ line, ch: 0 });
  view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
  view.editor.focus();
  return true;
}
