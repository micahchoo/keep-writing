// keep-writing: the vault interviews its owner. See CONTEXT.md.
//
// Write surface, whole: frontmatter properties (processFrontMatter), a block
// id appended to a paragraph (blocks.ts), and `> [!ask]` callouts (asks.ts).

import { MarkdownView, Notice, Plugin } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { asksOf, markAnswered } from './asks';
import { AnsweredIndex } from './bank';
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

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new AnsweredIndex(this.app);
    this.model = createModel(this.settings, (e) => console.debug('[keep-writing]', e));

    this.registerEvent(this.app.metadataCache.on('changed', () => this.index.invalidate()));
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
      callback: () => void this.askView().then((v) => v?.redraw('target')),
    });
    this.addCommand({
      id: 'ask-closing-question',
      name: 'Ask a closing question',
      callback: () => void this.askView().then((v) => v?.redraw('door')),
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

  private async askView(): Promise<AskView | null> {
    const leaf = await this.openPane(ASK_VIEW);
    return leaf?.view instanceof AskView ? leaf.view : null;
  }

  /**
   * Hand the pane the words the owner selected. Read here, where the editor
   * still holds the focus: opening the pane makes the pane the active leaf.
   */
  private async askAboutSelection(view: MarkdownView, selected: string, line: number): Promise<void> {
    const file = view.file;
    if (!file) return;
    const pane = await this.askView();
    await pane?.askAboutSelection({ file, selected, line });
  }

  private async markUnderCursor(view: MarkdownView, line: number): Promise<void> {
    const file = view.file;
    if (!file || !file.path.startsWith(this.settings.sittingsFolder + '/')) {
      new Notice('The active note is not a Sitting.');
      return;
    }
    const asks = await asksOf(this.app, file);
    const ask = asks.find((a) => a.answer.start <= line && line < a.answer.end);
    if (!ask) {
      new Notice('The cursor is not under an Ask.');
      return;
    }
    if (ask.answered) {
      new Notice('This answer is already linked.');
      return;
    }
    const answerRef = await markAnswered(this.app, file, ask, { bankFolder: this.settings.bankFolder });
    if (!answerRef) return;
    new Notice('Answer linked.');
    const pane = await this.askView();
    if (pane) void pane.afterAnswer(file, answerRef, ask);
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<KeepWritingSettings> | null) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.model = createModel(this.settings, (e) => console.debug('[keep-writing]', e));
  }
}
