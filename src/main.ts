// keep-writing: the vault interviews its owner. See CONTEXT.md.
//
// Write surface, whole: frontmatter properties (processFrontMatter), a block
// id appended to a paragraph (blocks.ts), and `> [!ask]` callouts (asks.ts).

import { MarkdownView, Notice, Plugin } from 'obsidian';
import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import { AnsweredIndex } from './bank';
import { Interview } from './interview';
import { linkParagraphCommand } from './link-command';
import { createModel } from './model';
import type { Model } from './model';
import { DEFAULT_SETTINGS, KeepWritingSettingTab } from './settings';
import type { KeepWritingSettings } from './settings';
import { ASK_VIEW, AskView } from './view-ask';
import { LINKS_VIEW, LinksView } from './view-links';

export default class KeepWritingPlugin extends Plugin {
  override settings: KeepWritingSettings = { ...DEFAULT_SETTINGS };
  index!: AnsweredIndex;
  model!: Model;
  /**
   * The Interview: CONTEXT.md calls it "the one thing that holds the state of
   * it while a Sitting is open". One thing, so the plugin owns it. It was
   * built inside AskView's constructor until 2026-09-17, which made it one per
   * PANE: two Ask panes were two skipped sets over one Sitting, closing the
   * pane threw the state away, and no command could reach an intent without
   * opening a pane first.
   */
  interview!: Interview;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new AnsweredIndex(this.app);
    this.model = this.buildModel();
    // The Surface's three jobs are not the pane's: placing a cursor and saying
    // a line are workspace work, and `changed` is every open pane's, not one's.
    this.interview = new Interview(this, {
      changed: () => {
        for (const pane of this.askPanes()) pane.refresh();
      },
      placeCursor: (file, line) => placeCursor(this.app, file, line),
      notice: (message) => {
        new Notice(message);
      },
    });

    // A note changed: answered-ness may have, and if it is the note the
    // Interview follows, so may its Asks. Plugin-level, not pane-level: the
    // Interview must keep up whether or not anything is drawing it.
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        this.index.invalidate();
        if (f.path === this.interview.state.file?.path) void this.interview.reloadAsks();
      }),
    );
    this.registerEvent(this.app.metadataCache.on('deleted', () => this.index.invalidate()));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.index.invalidate()));

    this.registerView(ASK_VIEW, (leaf) => new AskView(leaf, this));
    this.registerView(LINKS_VIEW, (leaf) => new LinksView(leaf, this.settings));

    this.addRibbonIcon('message-circle-question', 'Open Ask pane', () => void this.openPane(ASK_VIEW));

    this.addCommand({
      id: 'open-ask-pane',
      name: 'Open Ask pane',
      callback: () => void this.openPane(ASK_VIEW),
    });
    this.addCommand({
      id: 'open-links-pane',
      name: 'Open Links pane',
      callback: () => void this.openPane(LINKS_VIEW),
    });
    this.addCommand({
      id: 'draw-question',
      name: 'Draw a question',
      callback: () => void this.inPane(() => this.interview.redraw('target')),
    });
    this.addCommand({
      id: 'ask-closing-question',
      name: 'Ask a closing question',
      callback: () => void this.inPane(() => this.interview.redraw('door')),
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
        if (view instanceof MarkdownView) void this.askAboutSelection(view, editor.getSelection(), editor.getCursor('from').line);
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

  private async openPane(type: string): Promise<WorkspaceLeaf | null> {
    const existing = this.app.workspace.getLeavesOfType(type)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return null;
    if (!existing) await leaf.setViewState({ type, active: true });
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  /** Every open Ask pane. None open is legal: the intent runs, nothing draws it. */
  private askPanes(): AskView[] {
    return this.app.workspace
      .getLeavesOfType(ASK_VIEW)
      .map((leaf) => leaf.view)
      .filter((view): view is AskView => view instanceof AskView);
  }

  /** Show the Ask pane, then run the intent, so the owner sees what it did. */
  private async inPane(intent: () => Promise<void> | void): Promise<void> {
    await this.openPane(ASK_VIEW);
    await intent();
  }

  /**
   * Hand the Interview the words the owner selected. Read here, where the
   * editor still holds the focus: opening the pane makes the pane the active
   * leaf.
   */
  private async askAboutSelection(view: MarkdownView, selected: string, line: number): Promise<void> {
    const file = view.file;
    if (!file) return;
    await this.inPane(() => this.interview.askAbout({ file, selected, line }));
  }

  /**
   * Hand the Interview the note and the line the cursor is on, for the same
   * reason askAboutSelection hands it the selection: opening the pane makes
   * the pane the active leaf, so the editor has to be read here. Which Ask
   * that line is under, and every way it can refuse, is the Interview's.
   */
  private async markUnderCursor(view: MarkdownView, line: number): Promise<void> {
    const file = view.file;
    if (!file) return;
    await this.inPane(() => this.interview.markAt({ file, line }));
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

/**
 * Put the cursor at a line of a note, if the owner is looking at that note.
 * The Interview asks its Surface for this; it is workspace work, not the Ask
 * pane's — the pane has no editor of its own.
 */
function placeCursor(app: App, file: TFile, line: number): void {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (view?.file?.path !== file.path) return;
  view.editor.setCursor({ line, ch: 0 });
  view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
  view.editor.focus();
}
