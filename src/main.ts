import { readOffer } from './recovery';
import type { FollowUpOffer } from './recovery';
import { unmarkAt } from './unmark';
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
import { AnsweredIndex } from './bank';
import type { Drawn } from './bank';
import { Interview, REVISIT_FALLBACK, jarsLine } from './interview';
import type { Reach } from './interview';
import { createModel } from './model';
import type { Model, RevisitCandidate } from './model';
import { installBank, installedLine, questionCount } from './install';
import { OfferModal, choose } from './modals';
import type { Choice } from './modals';
import type { Paragraph } from './paragraphs';
import { formatRef } from './refs';
import { modelFailureLine } from './refusal';
import { DEFAULT_SETTINGS, KeepWritingSettingTab } from './settings';
import { STARTER_BANK } from './starter-bank';
import type { KeepWritingSettings } from './settings';
import { isSitting } from './target';

// The three things the plugin does. The command palette and the context menu
// read the same four names, so they cannot drift apart.
const DRAW = 'Draw a question';
const ASK_SELECTION = 'Ask about the selection';
const UNMARK = 'Unmark this answer';
const REOPEN = 'Reopen latest follow-ups';
const MARK = 'Mark this answer done, and follow up';
const INSTALL = 'Install the starter question bank';
const MENU = 'Open the menu';

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
 * the three commands go flat in their own section when it is missing.
 */
type Submenuable = { setSubmenu(): Menu };

/** Groups the commands when this build of Obsidian has no submenus. */
const SECTION = 'keep-writing';

export default class KeepWritingPlugin extends Plugin {
  override settings: KeepWritingSettings = { ...DEFAULT_SETTINGS };
  index!: AnsweredIndex;
  private acceptingOffer = false;
  private followUpOffer: FollowUpOffer | null = null;
  private indexTimer?: number;
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
    const schedule = () => {
      if (this.indexTimer) window.clearTimeout(this.indexTimer);
      this.indexTimer = window.setTimeout(() => {
        const s = this.settings;
        void this.index.jars(s.bankFolder, s.sittingsFolder, s.writingFolders).catch(error => console.warn('Keep Writing index:', error));
      }, 250);
    };
    this.registerEvent(this.app.metadataCache.on('changed', file => { this.index.invalidate(file); schedule(); }));
    this.registerEvent(this.app.metadataCache.on('resolve', file => this.index.resolve(file)));
    this.registerEvent(this.app.metadataCache.on('deleted', file => this.index.remove(file.path)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { if (file instanceof TFile) this.index.rename(file, oldPath); else this.index.invalidate(); schedule(); }));
    this.register(() => { if (this.indexTimer) window.clearTimeout(this.indexTimer); this.index.dispose(); });


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

    this.app.workspace.onLayoutReady(() => this.offerStarterBank());

    this.addRibbonIcon('message-circle-question', 'Draw a question', () => void this.drawQuestion());

    this.addCommand({ id: 'reopen-follow-ups', name: REOPEN, callback: () => this.reopenFollowUps() });
    this.addCommand({ id: 'unmark-answer', name: UNMARK, editorCallback: (editor, view) => {
      if (view instanceof MarkdownView) void this.unmarkUnderCursor(view, editor.getCursor().line);
    } });
    this.addCommand({ id: 'draw-question' , name: DRAW, callback: () => void this.drawQuestion() });
    this.addCommand({
      id: 'mark-answer-under-cursor',
      name: MARK,
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) void this.markUnderCursor(view, editor.getCursor().line);
      },
    });
    this.addCommand({ id: 'install-starter-bank', name: INSTALL, callback: () => void this.installStarterBank() });
    this.addCommand({ id: 'menu', name: MENU, callback: () => this.openMenu() });
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
        const ask = (target: Menu, flat: boolean) => {
          for (const [title, run] of [[UNMARK, () => void this.unmarkUnderCursor(view, at)], [REOPEN, () => this.reopenFollowUps()]] as const) {
            target.addItem(item => { item.setTitle(title); if (flat) item.setSection(SECTION); item.onClick(run); });
          }
          if (selected.trim()) {
            target.addItem((i) => {
              i.setTitle(ASK_SELECTION).setIcon('message-circle-question');
              if (flat) i.setSection(SECTION);
              i.onClick(() => void this.askAboutSelection(view, selected, from));
            });
          }
          target.addItem((i) => {
            i.setTitle(MARK).setIcon('check');
            if (flat) i.setSection(SECTION);
            i.onClick(() => void this.markUnderCursor(view, at));
          });
        };

        // Flat on mobile even where submenus exist: a nested menu wants a
        // hover and a second precise tap, and a phone has neither. The
        // fallback written for builds WITHOUT `setSubmenu` is the same shape
        // touch wants, so mobile takes that branch rather than a second one.
        let flat = Platform.isMobile;
        menu.addItem((item) => {
          const nest = (item as Partial<Submenuable>).setSubmenu;
          if (flat || typeof nest !== 'function') {
            // No submenus here. This item becomes the draw itself and the rest
            // follow it, so nothing is lost and nothing throws.
            flat = true;
            item.setTitle(DRAW).setIcon('shuffle').setSection(SECTION).onClick(() => void this.drawQuestion());
            return;
          }
          item.setTitle(SECTION).setIcon('message-circle-question');
          const sub = nest.call(item);
          sub.addItem((i) => i.setTitle(DRAW).setIcon('shuffle').onClick(() => void this.drawQuestion()));
          ask(sub, false);
        });
        if (flat) ask(menu, true);
      }),
    );
    this.addSettingTab(new KeepWritingSettingTab(this.app, this));
  }

  /**
   * Everything the plugin does, as one chooser.
   *
   * The right-click submenu is the desktop way in, and a phone has no right
   * click. Obsidian's own answer is the command palette and the mobile
   * toolbar, and both reach ONE command at a time — so the four commands are
   * all reachable and none of them is discoverable. This is the submenu as a
   * single command: one toolbar slot, all of it.
   *
   * The editor is read HERE, before anything opens, because opening makes the
   * new thing the active leaf. An action that needs an editor is offered only
   * when there is one.
   */
  private openMenu(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const selected = view?.editor.getSelection() ?? '';
    const from = view?.editor.getCursor('from').line ?? 0;
    const at = view?.editor.getCursor().line ?? 0;

    const actions: Choice<() => void>[] = [
      { value: () => void this.drawQuestion(), title: DRAW, note: 'Three to pick from. Escape writes nothing.' },
    ];
    if (this.followUpOffer?.questions.length) actions.push({ title: REOPEN, value: () => this.reopenFollowUps() });
    if (view && selected.trim()) {
      actions.push({
        value: () => void this.askAboutSelection(view, selected, from),
        title: ASK_SELECTION,
        note: 'Be asked about the words you highlighted.',
      });
    }
    if (view) {
      actions.push({ title: UNMARK, value: () => void this.unmarkUnderCursor(view, at), note: 'Remove the answer links; keep text and block IDs.' });
      actions.push({
        value: () => void this.markUnderCursor(view, at),
        title: MARK,
        note: 'Link the answer you are in, then offer what follows from it.',
      });
    }
    actions.push({
      value: () => void this.installStarterBank(),
      title: INSTALL,
      note: 'Write the question notes into your bank folder. Safe to run twice.',
    });
    choose(this.app, actions, 'what would you like to do?', (run) => run());
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
      void this.saveSettings();
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
        void this.installStarterBank();
      },
      answered,
    ).open();
  }

  /** Write the shipped question notes, skipping any that are already there. */
  private async installStarterBank(): Promise<void> {
    const { bankFolder } = this.settings;
    try {
      const result = await installBank(this.app, bankFolder, STARTER_BANK);
      this.index.invalidate();
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
      (candidate) => void this.interview.acceptFrom(sitting, paragraph, candidate, reach),
    );
  }

  /**
   * Mark the answer the cursor is in, then offer whatever bonsai found in it.
   * The note and the line are read here, while the editor still holds focus.
   *
   * Run it again on the same answer to ask for another Follow-up: marking an
   * answer twice writes nothing, and the questions are composed afresh. The latest offer
   * is also saved and can be reopened without composing again.
   */
  private async markUnderCursor(view: MarkdownView, line: number): Promise<void> {
    const file = view.file;
    if (!file) return;
    const answered = await this.composing(() => this.interview.markAt({ file, line }));
    if (!answered) return;
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
    this.followUpOffer = { sitting: file.path, ref: answered.ref, questions: answered.questions };
    try { await this.persistSettings(); }
    catch (error) { new Notice(`Follow-ups are kept for this session only: ${error instanceof Error ? error.message : String(error)}`); }
    this.reopenFollowUps();
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

  private async unmarkUnderCursor(view: MarkdownView, line: number): Promise<void> {
    const file = view.file;
    if (!file || !isSitting(file, this.settings.sittingsFolder)) { new Notice('Open a daily note to unmark an answer.'); return; }
    try { const message = await unmarkAt(this.app, file, line); this.index.invalidate(file); new Notice(message); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
  }

  private reopenFollowUps(): void {
    const offer = this.followUpOffer;
    if (!offer || !offer.questions.length) { new Notice('No saved follow-ups. Mark an answer done to compose some.'); return; }
    const file = this.app.vault.getFileByPath(offer.sitting);
    const source = this.app.metadataCache.getFirstLinkpathDest(offer.ref.path, offer.sitting);
    if (!file || !source || !offer.ref.blockId || !this.app.metadataCache.getFileCache(source)?.blocks?.[offer.ref.blockId]) { new Notice('The saved offer’s source is missing or still indexing. No question was inserted.'); return; }
    choose(this.app, offer.questions.map(question => ({ value: question, title: question })), 'Saved follow-ups · reopen from the command palette', question => {
      if (this.acceptingOffer || this.followUpOffer !== offer || !offer.questions.includes(question)) return;
      this.acceptingOffer = true;
      void this.interview.acceptFollowUp(file, question, offer.ref).then(async () => {
        if (this.followUpOffer !== offer) return;
        this.followUpOffer = { ...offer, questions: offer.questions.filter(value => value !== question) };
        await this.persistSettings();
      }).catch(error => new Notice(String(error))).finally(() => { this.acceptingOffer = false; });
    });
  }

  private buildModel(): Model {
    return createModel(this.settings, (e) => console.debug('[keep-writing]', e));
  }

  async loadSettings(): Promise<void> {
    const loaded: unknown = await this.loadData();
    const data = loaded && typeof loaded === 'object' ? loaded as Partial<KeepWritingSettings> & { followUpOffer?: unknown } : {};
    this.settings = { ...DEFAULT_SETTINGS, ...data };
    this.followUpOffer = readOffer(data.followUpOffer);
    const secret = this.app.secretStorage.getSecret('keep-writing-api-key');
    const legacy = typeof data.apiKey === 'string' ? data.apiKey : '';
    if (!secret && legacy) this.app.secretStorage.setSecret('keep-writing-api-key', legacy);
    this.settings.apiKey = this.app.secretStorage.getSecret('keep-writing-api-key') ?? '';
    if (legacy && !secret && this.settings.apiKey !== legacy) throw new Error('API key migration failed. The existing settings were preserved.');
    this.settings.bankShare = typeof data.bankShare === 'number' && Number.isFinite(data.bankShare) ? Math.max(0, Math.min(1, data.bankShare)) : 0.7;
    if ('apiKey' in data) await this.persistSettings();
  }
  private async persistSettings(): Promise<void> {
    const { apiKey: _apiKey, ...settings } = this.settings;
    await this.saveData({ ...settings, followUpOffer: this.followUpOffer });
  }
  async saveSettings(): Promise<void> {
    this.app.secretStorage.setSecret('keep-writing-api-key', this.settings.apiKey);
    if ((this.app.secretStorage.getSecret('keep-writing-api-key') ?? '') !== this.settings.apiKey) throw new Error('Could not save the API key to Obsidian secret storage.');
    await this.persistSettings();
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
