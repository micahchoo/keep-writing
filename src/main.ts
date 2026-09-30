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
import { Interview, REVISIT_FALLBACK, emptyDrawLine, jarsLine } from './interview';
import type { Answered, Reach } from './interview';
import { createModel, fetcher } from './model';
import type { Model, RevisitCandidate } from './model';
import { BankInstallModal, offerBankUpdate } from './bank-modals';
import { normalizeBankWeights } from './bank-mix';
import { INVITATION_WHERE, LENS_VERSION, MAX_STANCE_WORDS, REVISIT_WHERE, readLens, upgradeLens } from './lens';
import { GraduateModal } from './graduate-modal';
import { choose } from './modals';
import type { Choice } from './modals';
import { sittingName } from './paragraphs';
import type { Paragraph } from './paragraphs';
import { formatRef } from './refs';
import { Refused, modelFailureLine, refusalLine } from './refusal';
import { DEFAULT_SETTINGS, KeepWritingSettingTab, keepBanksFresh, keepFoldersFresh, normalizeBankShare, readFolders } from './settings';
import { STARTER_BANK } from './starter-bank';
import type { KeepWritingSettings } from './settings';
import { isSitting } from './target';
import { findServers as probeServers } from './endpoint';
import { DAY_FORMAT, dailyNotesOf, sharesDailyFolder } from './daily';
import { SetupModal } from './setup-modal';
import type { Probe } from './endpoint';

// What the plugin does, as the command palette names it.
const DRAW = 'Draw a question';
const ASK_SELECTION = 'Ask about the selection';
const MARK = 'Mark this answer done, and follow up';
const INSTALL = 'Choose question banks to install';
const SET_UP = 'Set up keep-writing';
const UPDATE = 'Add new questions to installed banks';
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

    this.app.workspace.onLayoutReady(() => {
      this.offerSetup();
      this.run(() => this.offerNewQuestions());
    });

    this.addRibbonIcon('message-circle-question', 'Draw a question', () => this.run(() => this.drawQuestion()));

    this.addCommand({ id: 'draw-question' , name: DRAW, callback: () => this.run(() => this.drawQuestion()) });
    this.addCommand({
      id: 'mark-answer-under-cursor',
      name: MARK,
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) this.run(() => this.markUnderCursor(view, editor.getCursor().line));
      },
    });
    this.addCommand({ id: 'set-up', name: SET_UP, callback: () => this.openSetup() });
    this.addCommand({ id: 'install-starter-bank', name: INSTALL, callback: () => this.installStarterBank() });
    this.addCommand({
      id: 'update-starter-bank',
      name: UPDATE,
      callback: () => this.run(() => offerBankUpdate(this.app, this.settings.bankFolder, STARTER_BANK, { quiet: false })),
    });
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
    const settingsTab = new KeepWritingSettingTab(this.app, this);
    this.addSettingTab(settingsTab);
    keepFoldersFresh(this.app, settingsTab, (ref) => this.registerEvent(ref));
    keepBanksFresh(this.app, this, settingsTab, (ref) => this.registerEvent(ref));
  }

  // -------------------------------------------------------------------------
  // The starter Bank

  /**
   * First run: setup, once. It replaced a single offer to fill the bank on
   * 2026-09-30 — the bank was the one thing first run asked about, and the
   * daily notes folder, the owner's old writing and the AI server were left
   * to fail quietly. Either answer records that it was offered; the command
   * stays in the palette.
   *
   * It waits for the metadata cache to finish indexing: setup counts each
   * folder's paragraphs from it, and a half-built cache would make years of
   * writing look like none.
   */
  private offerSetup(): void {
    if (this.settings.starterOffered) return;
    const { metadataCache } = this.app;
    const ref = metadataCache.on('resolved', () => {
      metadataCache.offref(ref);
      if (!this.unloaded && !this.settings.starterOffered) this.openSetup();
    });
    this.registerEvent(ref);
  }

  private openSetup(): void {
    new SetupModal(this.app, this, () => this.run(() => this.drawQuestion())).open();
  }

  /**
   * A release that ships new questions offers them to the banks the owner
   * already has, once per version: marked offered before it is shown, so an
   * answer of either kind, or none, is the end of it until the next version.
   * Quiet when nothing installed is missing anything, which is every load of
   * a version that shipped no new questions.
   */
  private async offerNewQuestions(): Promise<void> {
    const version = this.manifest.version;
    if (this.settings.updateOfferedFor === version) return;
    this.settings.updateOfferedFor = version;
    await this.saveSettings();
    await offerBankUpdate(this.app, this.settings.bankFolder, STARTER_BANK, { quiet: true });
  }

  /** Let the owner choose which shipped question notes to add. */
  private installStarterBank(): void {
    new BankInstallModal(this.app, this.settings.bankFolder, () => {}).open();
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
      new Notice(emptyDrawLine(jars, target, this.settings.writingFolders, this.settings.bankFolder));
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
      paragraph.title,
      (candidate) => this.run(() => this.interview.acceptFrom(sitting, paragraph, candidate)),
    );
  }

  /**
   * Mark the answer the cursor is in, then offer whatever bonsai found in it.
   * The note and the line are read here, while the editor still holds focus.
   *
   * Run it again on the same answer to ask for another Follow-up: marking an
   * answer twice writes nothing, and the Follow-up is sampled, so it usually
   * finds other questions. That is the way back to a dismissed offer; nothing
   * is kept between. "Different questions" in the chooser is the sure way:
   * the modal still holds what it offered, and hands it back to be excluded.
   */
  private async markUnderCursor(view: MarkdownView, line: number): Promise<void> {
    const file = view.file;
    if (!file) return;
    const answered = await this.composing(() => this.interview.markAt({ file, line }));
    if (!answered || this.unloaded) return;
    this.offerFollowUps(file, answered, answered.questions, answered.error, []);
  }

  /**
   * The chooser for Follow-ups. `offered` is every question shown for this
   * answer since it was marked, so "Different questions" never repeats one.
   */
  private offerFollowUps(file: TFile, answered: Answered, questions: string[], error: string | null, offered: string[]): void {
    if (questions.length === 0) {
      // Never nothing: a silent command reads as a broken one. And never the
      // WRONG nothing: "nothing to follow up with" is the model declining, and
      // saying it after a 404 blamed the model for a setting the owner could
      // have fixed in ten seconds.
      new Notice(
        !this.model.available
          ? this.model.reason
          : error
            ? modelFailureLine(error)
            : offered.length
              ? 'No different questions this time.'
              : 'Nothing to follow up with. Run it again to ask afresh.',
      );
      return;
    }
    const shown = [...offered, ...questions];
    const choices: Choice<string | null>[] = [
      ...questions.map(question => ({ value: question, title: question })),
      { value: null, title: 'Different questions', note: 'Ask again, leaving out the ones shown here' },
    ];
    choose(this.app, choices, 'Follow up · or ask for different questions', question => {
      if (question !== null) {
        this.run(() => this.interview.acceptFollowUp(file, question, answered.ref));
        return;
      }
      this.run(async () => {
        const more = await this.composing(() => this.interview.moreFollowUps(file, answered, shown));
        if (!this.unloaded) this.offerFollowUps(file, answered, more.questions, more.error, shown);
      });
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
    const folder = this.settings.sittingsFolder;
    const daily = dailyNotesOf(this.app);
    // Sharing the Daily notes folder, Obsidian makes today's note: its date
    // format and its template, not ours. Made by us in another format, the
    // day would have two notes.
    if (!isSitting(active, folder) && sharesDailyFolder(daily, folder)) {
      const today = await this.openDailyNote();
      if (isSitting(today, folder)) return today;
      if (daily?.format !== DAY_FORMAT) throw new Refused('Obsidian did not open today’s daily note. Open it, then try again.');
    }
    const sitting = await this.interview.sitting(active);
    if (sitting.path !== active?.path) await this.app.workspace.getLeaf(false).openFile(sitting);
    return sitting;
  }

  /**
   * Run Obsidian's own "Open today's daily note" and hand back what it opened.
   * The command is not published API, so it is looked up; missing, or
   * opening nothing within a few seconds, is null and the caller decides.
   */
  private async openDailyNote(): Promise<TFile | null> {
    const commands = (this.app as { commands?: { executeCommandById?: (id: string) => boolean } }).commands;
    if (!commands?.executeCommandById) return null;
    const { workspace } = this.app;
    const opened = new Promise<TFile | null>((resolve) => {
      const ref = workspace.on('file-open', (file) => { workspace.offref(ref); window.clearTimeout(timer); resolve(file); });
      // Already open elsewhere, the command may only reveal it: no event.
      const timer = window.setTimeout(() => { workspace.offref(ref); resolve(workspace.getActiveFile()); }, 3000);
    });
    if (!commands.executeCommandById('daily-notes')) return null;
    return opened;
  }

  private run(job: () => Promise<unknown>): void {
    if (this.unloaded) return;
    void job().catch(error => {
      if (this.unloaded) return;
      new Notice(error instanceof Error ? error.message : String(error));
    });
  }

  findServers(): Promise<Probe[]> {
    return probeServers(fetcher, this.settings.baseUrl, this.settings.apiKey);
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
    this.settings.bankWeights = normalizeBankWeights(data.bankWeights);
    // A Lens edited before the list moved into it keeps the list in front.
    // Written back only when that changed one; otherwise the version is saved
    // with the next write, and reading an old Lens again gives the same answer.
    const craft = upgradeLens(data.craftLens, REVISIT_WHERE, data.lensVersion);
    const invitation = upgradeLens(data.invitationLens, INVITATION_WHERE, data.lensVersion);
    const upgraded = craft !== data.craftLens || invitation !== data.invitationLens;
    this.settings.craftLens = readLens(craft);
    this.settings.invitationLens = readLens(invitation);
    this.settings.followUpLens = readLens(data.followUpLens);
    this.settings.stance = readLens(data.stance, MAX_STANCE_WORDS);
    this.settings.lensVersion = LENS_VERSION;
    if ('apiKey' in data || upgraded) await this.persistSettings();
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
