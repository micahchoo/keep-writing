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

import { MarkdownView, Notice, Platform, Plugin, TFile } from 'obsidian';
import type { App, Menu } from 'obsidian';
import type { Drawn } from './bank';
import { Interview, REVISIT_FALLBACK, jarsLine } from './interview';
import type { Reach } from './interview';
import { createModel } from './model';
import type { Model, RevisitCandidate } from './model';
import { installBank, installedLine, questionCount } from './install';
import { GraduateModal } from './graduate-modal';
import { OfferModal, choose } from './modals';
import type { Choice } from './modals';
import { sittingName } from './paragraphs';
import type { Paragraph } from './paragraphs';
import { formatRef } from './refs';
import { modelFailureLine, refusalLine } from './refusal';
import { DEFAULT_SETTINGS, KeepWritingSettingTab, normalizeBankShare, readFolders } from './settings';
import { STARTER_BANK } from './starter-bank';
import type { KeepWritingSettings } from './settings';
import { isSitting } from './target';

// What the plugin does, as the command palette names it.
const DRAW = 'Draw a question';
const ASK_SELECTION = 'Ask about the selection';
const MARK = 'Mark this answer done, and follow up';
const INSTALL = 'Install the starter question bank';
const GRADUATE = 'Graduate threads to pieces';

/**
 * `MenuItem.setSubmenu` is absent from the published typings and present in
 * the app: Obsidian builds its own menus with it — `setSubmenu().addItem(e =>
 * e.setSection(...))` reads straight out of obsidian.asar, checked 2026-09-17
 * against the installed 1.13. This is the one place the plugin reaches past
 * its types, and it is a menu: nothing the interview does depends on it.
 *
 * Because it is undocumented it may be absent, and calling it then throws
 * inside an `editor-menu` handler — which would take out the WHOLE right-click
 * menu, Obsidian's own items included, not just ours. So it is tested for, and
 * the actions go flat in their own section when it is missing.
 */
type Submenuable = { setSubmenu(): Menu };

/** Names the submenu, and groups the actions when there is none. */
const SECTION = 'keep-writing';

/** One right-click action: what it says, its icon, what it runs. */
export interface MenuAction {
  title: string;
  icon: string;
  run: () => void;
}

/**
 * Put the actions on the editor's context menu: under one `keep-writing`
 * submenu where this build has submenus, flat in their own section where it
 * does not. Flat on a phone even where submenus exist: a nested menu wants a
 * hover and a second precise tap, and a touch screen has neither.
 */
export function addMenuActions(menu: Menu, actions: MenuAction[], mobile: boolean): void {
  const [head, ...rest] = actions;
  if (!head) return;
  const nested: { menu?: Menu } = {};
  // One item decides the layout: it becomes the submenu when there are
  // submenus, and the first action itself when there are none, so the probe
  // costs no empty row.
  menu.addItem((item) => {
    const nest = (item as Partial<Submenuable>).setSubmenu;
    if (!mobile && typeof nest === 'function') {
      item.setTitle(SECTION).setIcon('message-circle-question');
      nested.menu = nest.call(item);
    } else {
      item.setTitle(head.title).setIcon(head.icon).setSection(SECTION).onClick(head.run);
    }
  });
  if (nested.menu) {
    for (const a of actions) nested.menu.addItem((i) => i.setTitle(a.title).setIcon(a.icon).onClick(a.run));
  } else {
    for (const a of rest) menu.addItem((i) => i.setTitle(a.title).setIcon(a.icon).setSection(SECTION).onClick(a.run));
  }
}

export default class KeepWritingPlugin extends Plugin {
  override settings: KeepWritingSettings = { ...DEFAULT_SETTINGS };
  model!: Model;
  interview!: Interview;
  /** Set on unload. A modal or a model reply can outlive the plugin; neither may act after it. */
  private unloaded = false;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.register(() => { this.unloaded = true; });
    this.model = this.buildModel();
    this.interview = new Interview(this, {
      placeCursor: (file, line) => placeCursor(this.app, file, line),
      notice: (message) => {
        new Notice(message);
      },
    });

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
            this.run(() => this.interview.seed(file));
          }
        }),
      );
    });

    this.app.workspace.onLayoutReady(() => this.offerStarterBank());

    this.addRibbonIcon('message-circle-question', 'Draw a question', () => this.run(() => this.drawQuestion()));

    this.addCommand({ id: 'draw-question' , name: DRAW, callback: () => this.run(() => this.drawQuestion()) });
    this.addCommand({
      id: 'mark-answer-under-cursor',
      name: MARK,
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) this.run(() => this.markUnderCursor(view, editor.getCursor().line));
      },
    });
    this.addCommand({ id: 'install-starter-bank', name: INSTALL, callback: () => this.run(() => this.installStarterBank()) });
    this.addCommand({ id: 'graduate-threads', name: GRADUATE, callback: () => this.run(() => this.graduateThreads()) });
    this.addCommand({
      id: 'ask-about-selection',
      name: ASK_SELECTION,
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) {
          this.run(() => this.askAboutSelection(view, editor.getSelection(), editor.getCursor('from').line));
        }
      },
    });
    // Everything the plugin does, on the editor's own context menu. The editor
    // is read HERE, while it still holds what was right-clicked: by the time
    // an item is clicked the menu has the focus.
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        if (!(view instanceof MarkdownView)) return;
        const selected = editor.getSelection();
        const from = editor.getCursor('from').line;
        const at = editor.getCursor().line;
        const actions: MenuAction[] = [{ title: DRAW, icon: 'shuffle', run: () => this.run(() => this.drawQuestion()) }];
        if (selected.trim()) actions.push({ title: ASK_SELECTION, icon: 'message-circle-question', run: () => this.run(() => this.askAboutSelection(view, selected, from)) });
        actions.push({ title: MARK, icon: 'check', run: () => this.run(() => this.markUnderCursor(view, at)) });
        if (isSitting(view.file, this.settings.sittingsFolder)) actions.push({ title: GRADUATE, icon: 'sprout', run: () => this.run(() => this.graduateThreads()) });
        addMenuActions(menu, actions, Platform.isMobile);
      }),
    );
    this.addSettingTab(new KeepWritingSettingTab(this.app, this));
  }

  // -------------------------------------------------------------------------
  // The starter Bank

  /**
   * With nothing in the Bank folder, the plugin can draw nothing, so it says
   * so once and offers to fill it. It ASKS: this writes notes into somebody
   * else's vault, and how many, and where, is the copy's whole job.
   *
   * The gate is the folder's contents and not `bankNotes`, which reads
   * `kind: bank` out of the metadata cache — at first run the cache may still
   * be indexing, and a half-built cache would make a full Bank look empty.
   * Either answer records that the offer was made, so it is made once; the
   * command stays in the palette for anyone who changes their mind.
   */
  private offerStarterBank(): void {
    if (this.settings.starterOffered) return;
    const folder = this.app.vault.getFolderByPath(this.settings.bankFolder);
    if (folder && folder.children.length > 0) return;
    const answered = () => {
      this.settings.starterOffered = true;
      this.run(() => this.saveSettings());
    };
    new OfferModal(
      this.app,
      {
        title: 'Fill the question bank?',
        body: [
          `keep-writing draws from questions kept as ordinary notes. Your ${this.settings.bankFolder} folder is empty, so there is nothing to draw.`,
          `This writes ${STARTER_BANK.length === 1 ? 'one note' : `${STARTER_BANK.length} notes`} holding ${questionCount(STARTER_BANK).toLocaleString()} questions into ${this.settings.bankFolder}. They are plain Markdown, one question per line: edit them, delete them, add your own. Nothing is sent anywhere and no existing note is touched.`,
          'You can do this later from the command palette instead.',
        ],
        confirm: 'Write the notes',
        dismiss: 'Not now',
      },
      () => {
        answered();
        this.run(() => this.installStarterBank());
      },
      answered,
    ).open();
  }

  /** Write the shipped question notes, skipping any that are already there. */
  private async installStarterBank(): Promise<void> {
    const { bankFolder } = this.settings;
    try {
      const result = await installBank(this.app, bankFolder, STARTER_BANK);
      new Notice(installedLine(result, bankFolder));
    } catch (e) {
      new Notice(`Could not write the question bank: ${e instanceof Error ? e.message : String(e)}`);
    }
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
    if (this.unloaded) return;
    if (drawn.length === 0) {
      new Notice('Nothing left to draw. Every source here is answered or already asked.');
      return;
    }
    const where = target ? `only ${target}` : jarsLine(jars);
    choose(this.app, drawn.map(drawnChoice), where, (pick) => {
      const source = pick.source;
      if (source.kind === 'question') this.run(() => this.interview.accept(sitting, pick));
      // The draw chose it, not the owner: an Invitation, aimed at their
      // present. Except the pick-up, which the owner chose at the end of an
      // earlier Sitting — that one is interviewed, and reads in place.
      else this.run(() => this.offer(sitting, source, pick.pickUp ? 'pointed' : 'picked'));
    });
  }

  /**
   * Hand the Interview the words the owner selected. Read here, where the
   * editor still holds the focus.
   */
  private async askAboutSelection(view: MarkdownView, selected: string, line: number): Promise<void> {
    const file = view.file;
    if (!file) return;
    const paragraph = this.interview.selection({ file, selected, line, document: view.editor.getValue() });
    if (!paragraph) return;
    // The owner went and pointed at this: interview it.
    await this.offer(await this.interview.sitting(file), paragraph, 'pointed');
  }

  /** bonsai's questions from a paragraph, as the second chooser. */
  private async offer(sitting: TFile, paragraph: Paragraph, reach: Reach): Promise<void> {
    const offer = await this.composing(() => this.interview.offerFrom(paragraph, reach));
    if (this.unloaded) return;
    const lens = offer.lens ? ` · through the ${offer.lens} lens` : '';
    // The fallback below is indistinguishable from a composed question, so a
    // failure must say so. Silently substituting it told the owner the model
    // had answered when it had never been reached.
    if (offer.error) new Notice(modelFailureLine(offer.error));
    // A paragraph is never a dead end: with nothing composed, the one fixed form.
    const candidates: RevisitCandidate[] = offer.candidates.length
      ? offer.candidates
      : [{ question: REVISIT_FALLBACK }];
    choose(
      this.app,
      candidates.map((c) => revisitChoice(c)),
      `${paragraph.title}${lens}`,
      (candidate) => this.run(() => this.interview.acceptFrom(sitting, paragraph, candidate, reach)),
    );
  }

  /**
   * Mark the answer the cursor is in, then offer whatever bonsai found in it.
   * The note and the line are read here, while the editor still holds focus.
   *
   * Run it again on the same answer to ask for another Follow-up: marking an
   * answer twice writes nothing, and the questions are composed afresh. That
   * is the way back to a dismissed offer; nothing is kept between.
   */
  private async markUnderCursor(view: MarkdownView, line: number): Promise<void> {
    const file = view.file;
    if (!file) return;
    const answered = await this.composing(() => this.interview.markAt({ file, line }));
    if (!answered || this.unloaded) return;
    if (answered.questions.length === 0) {
      // Never nothing: a silent command reads as a broken one. And never the
      // WRONG nothing: "nothing to follow up with" is the model declining, and
      // saying it after a 404 blamed the model for a setting the owner could
      // have fixed in ten seconds.
      new Notice(
        !this.model.available
          ? this.model.reason
          : answered.error
            ? modelFailureLine(answered.error)
            : 'Nothing to follow up with. Run it again to ask afresh.',
      );
      return;
    }
    choose(this.app, answered.questions.map(question => ({ value: question, title: question })), 'Follow up · mark again for fresh ones', question => {
      this.run(() => this.interview.acceptFollowUp(file, question, answered.ref));
    });
  }

  /**
   * Graduate threads of the Sitting the owner is looking at. The note is read
   * here, before the form opens; everything the form offers and every write
   * is the Interview's.
   */
  private async graduateThreads(): Promise<void> {
    const sitting = this.app.workspace.getActiveFile();
    if (!sitting || !isSitting(sitting, this.settings.sittingsFolder)) {
      new Notice('Open a daily note to graduate its threads.');
      return;
    }
    let graduation;
    try {
      graduation = await this.interview.graduation(sitting);
    } catch (e) {
      new Notice(refusalLine(e));
      return;
    }
    if (this.unloaded) return;
    const snapshot = graduation.snapshot;
    new GraduateModal(this.app, {
      graduation,
      dayName: sittingName(sitting.basename).called,
      modelAvailable: this.model.available,
      summarize: (thread) => this.interview.summarize(snapshot, thread),
      suggestHeadings: (thread) => this.interview.suggestHeadings(snapshot, thread),
      graduate: async (choices) => {
        const made = await this.interview.graduate(sitting, snapshot, choices);
        new Notice(`Graduated to ${made.map((f) => f.basename).join(', ')}.`);
        const first = made[0];
        if (first) await this.app.workspace.getLeaf(false).openFile(first);
      },
    }).open();
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

  private run(job: () => Promise<unknown>): void {
    if (this.unloaded) return;
    void job().catch(error => {
      if (this.unloaded) return;
      new Notice(error instanceof Error ? error.message : String(error));
    });
  }

  private buildModel(): Model {
    return createModel(this.settings, (e) => console.debug('[keep-writing]', e));
  }

  async loadSettings(): Promise<void> {
    const loaded: unknown = await this.loadData();
    const data = loaded && typeof loaded === 'object' ? loaded as Partial<KeepWritingSettings> & { followUpOffer?: unknown } : {};
    // `followUpOffer` is 0.2.9's saved offer. Spreading `data` would carry it
    // into every later write; it is dropped instead.
    const { followUpOffer: _offer, ...stored } = data;
    this.settings = { ...DEFAULT_SETTINGS, ...stored };
    if (stored.writingFolders !== undefined) this.settings.writingFolders = readFolders(stored.writingFolders);
    const secret = this.app.secretStorage.getSecret('keep-writing-api-key');
    const legacy = typeof data.apiKey === 'string' ? data.apiKey : '';
    if (!secret && legacy) this.app.secretStorage.setSecret('keep-writing-api-key', legacy);
    this.settings.apiKey = this.app.secretStorage.getSecret('keep-writing-api-key') ?? '';
    if (legacy && !secret && this.settings.apiKey !== legacy) throw new Error('API key migration failed. The existing settings were preserved.');
    this.settings.bankShare = normalizeBankShare(data.bankShare);
    if ('apiKey' in data) await this.persistSettings();
  }
  private async persistSettings(): Promise<void> {
    const { apiKey: _apiKey, ...settings } = this.settings;
    await this.saveData(settings);
  }
  async saveSettings(): Promise<void> {
    this.app.secretStorage.setSecret('keep-writing-api-key', this.settings.apiKey);
    if ((this.app.secretStorage.getSecret('keep-writing-api-key') ?? '') !== this.settings.apiKey) throw new Error('Could not save the API key to Obsidian secret storage.');
    await this.persistSettings();
    this.model = this.buildModel();
  }

}

/** Pure: one drawn source as a row — what it says, and where it comes from. */
function drawnChoice(drawn: Drawn): Choice<Drawn> {
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
function revisitChoice(candidate: RevisitCandidate): Choice<RevisitCandidate> {
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
