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

import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import type { App, Menu } from 'obsidian';
import { AnsweredIndex } from './bank';
import type { Drawn } from './bank';
import { Interview, REVISIT_FALLBACK, jarsLine } from './interview';
import type { Reach } from './interview';
import { createModel } from './model';
import type { Model, RevisitCandidate } from './model';
import { choose } from './modals';
import type { Choice } from './modals';
import type { Paragraph } from './paragraphs';
import { formatRef } from './refs';
import { DEFAULT_SETTINGS, KeepWritingSettingTab } from './settings';
import type { KeepWritingSettings } from './settings';
import { isSitting } from './target';

// The three things the plugin does. The command palette and the context menu
// read the same four names, so they cannot drift apart.
const DRAW = 'Draw a question';
const ASK_SELECTION = 'Ask about the selection';
const MARK = 'Mark this answer done, and follow up';

/**
 * `MenuItem.setSubmenu` is absent from the published typings and present in
 * the app: Obsidian builds its own menus with it — `setSubmenu().addItem(e =>
 * e.setSection(...))` reads straight out of obsidian.asar, checked 2026-09-17
 * against the installed 1.13. This is the one place the plugin reaches past
 * its types, and it is a menu: nothing the interview does depends on it.
 */
type Submenuable = { setSubmenu(): Menu };

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

    // A Sitting nobody has written in yet is a blank page, and the blank page
    // is the failure mode the owner named. Whoever makes the note — this
    // plugin, the daily-notes plugin, a template, or the owner by hand — one
    // Bank question goes into it. No model call on this path: see
    // `Interview#seed`.
    //
    // Registered only once the layout is ready, because `create` fires for
    // every note in the vault while Obsidian indexes it at startup.
    //
    // When the owner's first move of the day IS the draw, the Sitting is born
    // here and the draw appends its own Ask beside the seeded one. Two
    // questions in a fresh note, which is what both of those things mean.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on('create', (file) => {
          if (file instanceof TFile && isSitting(file, this.settings.sittingsFolder)) {
            void this.interview.seed(file);
          }
        }),
      );
    });

    this.addRibbonIcon('message-circle-question', 'Draw a question', () => void this.drawQuestion());

    this.addCommand({ id: 'draw-question', name: DRAW, callback: () => void this.drawQuestion() });
    this.addCommand({
      id: 'mark-answer-under-cursor',
      name: MARK,
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) void this.markUnderCursor(view, editor.getCursor().line);
      },
    });
    this.addCommand({
      id: 'ask-about-selection',
      name: ASK_SELECTION,
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) {
          void this.askAboutSelection(view, editor.getSelection(), editor.getCursor('from').line);
        }
      },
    });
    // Everything the plugin does, under one submenu of the editor's own
    // context menu. Right-clicking is how the owner reaches it without
    // learning four command names.
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        if (!(view instanceof MarkdownView)) return;
        // Read the editor HERE, while it still holds what was right-clicked.
        // By the time an item is clicked the menu has the focus.
        const selected = editor.getSelection();
        const from = editor.getCursor('from').line;
        const at = editor.getCursor().line;
        menu.addItem((item) => {
          item.setTitle('keep-writing').setIcon('message-circle-question');
          const sub = (item as unknown as Submenuable).setSubmenu();
          sub.addItem((i) => i.setTitle(DRAW).setIcon('shuffle').onClick(() => void this.drawQuestion()));
          if (selected.trim()) {
            sub.addItem((i) =>
              i
                .setTitle(ASK_SELECTION)
                .setIcon('message-circle-question')
                .onClick(() => void this.askAboutSelection(view, selected, from)),
            );
          }
          sub.addItem((i) => i.setTitle(MARK).setIcon('check').onClick(() => void this.markUnderCursor(view, at)));
        });
      }),
    );
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
      // The draw chose it, not the owner: an Invitation, aimed at their
      // present. Except the pick-up, which the owner chose at the end of an
      // earlier Sitting — that one is interviewed, and reads in place.
      else void this.offer(sitting, pick.source, pick.pickUp ? 'pointed' : 'picked');
    });
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
    // The owner went and pointed at this: interview it.
    await this.offer(await this.interview.sitting(file), paragraph, 'pointed');
  }

  /** bonsai's questions from a paragraph, as the second chooser. */
  private async offer(sitting: TFile, paragraph: Paragraph, reach: Reach): Promise<void> {
    const offer = await this.composing(() => this.interview.offerFrom(paragraph, reach));
    const lens = offer.lens ? ` · through the ${offer.lens} lens` : '';
    // A paragraph is never a dead end: with nothing composed, the one fixed form.
    const candidates: RevisitCandidate[] = offer.candidates.length
      ? offer.candidates
      : [{ question: REVISIT_FALLBACK }];
    choose(
      this.app,
      candidates.map((c) => revisitChoice(c)),
      `${paragraph.title}${lens}`,
      (candidate) => void this.interview.acceptFrom(sitting, paragraph, candidate, reach),
    );
  }

  /**
   * Mark the answer the cursor is in, then offer whatever bonsai found in it.
   * The note and the line are read here, while the editor still holds focus.
   *
   * Run it again on the same answer to ask for another Follow-up: marking an
   * answer twice writes nothing, and the questions are composed afresh. That
   * is the only way back to them, because the chooser does not persist.
   */
  private async markUnderCursor(view: MarkdownView, line: number): Promise<void> {
    const file = view.file;
    if (!file) return;
    const answered = await this.composing(() => this.interview.markAt({ file, line }));
    if (!answered) return;
    if (answered.questions.length === 0) {
      // Never nothing: a silent command reads as a broken one.
      new Notice(this.model.available ? 'Nothing to follow up with. Run it again to ask afresh.' : this.model.reason);
      return;
    }
    choose(
      this.app,
      answered.questions.map((q) => ({ value: q, title: q })),
      'follow up on this answer',
      (question) => void this.interview.acceptFollowUp(file, question, answered.ref),
    );
  }

  /**
   * Hold a "Composing…" notice for as long as bonsai is reading. Every model
   * call here takes seconds, and without this the command looks like it did
   * nothing.
   */
  private async composing<T>(job: () => Promise<T>): Promise<T> {
    if (!this.model.available) return job();
    const notice = new Notice('Composing…', 0);
    try {
      return await job();
    } finally {
      notice.hide();
    }
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
  const what = drawn.pickUp ? 'where you said to pick up' : 'revisit';
  return { value: drawn, title: text.replace(/\s+/g, ' ').trim(), note: [what, title, ...meta].join(' · ') };
}

/** Pure: one composed question as a row, with its due marker when it has one. */
export function revisitChoice(candidate: RevisitCandidate): Choice<RevisitCandidate> {
  const row: Choice<RevisitCandidate> = { value: candidate, title: candidate.question };
  if (candidate.dueDays !== undefined) row.note = `due in ${candidate.dueDays} days`;
  return row;
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
