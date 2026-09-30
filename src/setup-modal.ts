// The setup modal: shows what setup.ts proposes, lets the owner change it, and
// hands back the choices. It decides nothing — every default comes from
// `setupDefaults` — and writes nothing until Start writing.
//
// One modal, four sections, not a wizard: an offer lives in the modal that
// shows it and dies when the owner answers (see the interview seam), and a
// page of steps would be state to keep.

import { Modal, Notice, Setting, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { STARTER_BANK } from './starter-bank';
import { dailyAdvice, dailyNotesOf } from './daily';
import { probeLine } from './endpoint';
import type { Probe } from './endpoint';
import { installBank, installedLine, questionCount } from './install';
import { paragraphsByFolder } from './paragraphs';
import { folderOptions, reachLabel } from './settings';
import type { KeepWritingSettings } from './settings';
import { applySetup, folderCandidates, setupDefaults } from './setup';
import type { SetupChoices } from './setup';

export interface SetupHost {
  settings: KeepWritingSettings;
  saveSettings(): Promise<void>;
  findServers(): Promise<Probe[]>;
}

export class SetupModal extends Modal {
  private started = false;

  /**
   * `done` runs once setup is confirmed and written: the caller draws the
   * first question, so setup ends on the plugin's one core act.
   */
  constructor(app: App, private host: SetupHost, private done: () => void) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle('Set up keep-writing');
    this.contentEl.createEl('p', { text: 'Four things, each with a suggestion. Nothing changes until you start.' });
    const loading = this.contentEl.createEl('p', { cls: 'kw-setup-wait', text: 'Looking for your daily notes, your writing and an AI server…' });
    void this.host.findServers().then((probes) => {
      loading.remove();
      this.draw(probes);
    }).catch((e: unknown) => {
      loading.setText(e instanceof Error ? e.message : String(e));
    });
  }

  private draw(probes: Probe[]): void {
    const { settings } = this.host;
    const exists = (name: string) => !!this.app.vault.getAbstractFileByPath(normalizePath(`${settings.bankFolder}/${name}`));
    const daily = dailyNotesOf(this.app);
    const choices: SetupChoices = setupDefaults({
      settings,
      daily,
      probes,
      banks: STARTER_BANK.map((b) => ({ name: b.name, exists: exists(b.name) })),
    });
    const el = this.contentEl;

    // 1. Where questions go.
    new Setting(el).setName('Your daily notes').setHeading();
    const advice = dailyAdvice(daily, settings.sittingsFolder);
    const where = advice.kind === 'offer'
      ? `Obsidian’s daily notes go to ${advice.folder}, so questions will go there too, into notes made with your own template.`
      : advice.kind === 'top-level'
        ? 'Obsidian’s daily notes go to the top of your vault. Questions go into notes in one folder: choose it here, or set a folder in Obsidian’s Daily notes settings later.'
        : 'Questions go into a note for each day, in this folder.';
    const folders = this.app.vault.getAllFolders(false).map((f) => f.path);
    new Setting(el).setName('Folder for questions').setDesc(where).addDropdown((d) => d
      .addOptions(folderOptions(folders, [choices.sittingsFolder]))
      .setValue(choices.sittingsFolder)
      .onChange((folder) => {
        choices.writingFolders = choices.writingFolders.map((f) => (f === choices.sittingsFolder ? folder : f));
        choices.sittingsFolder = folder;
      }));

    // 2. What questions can come from.
    new Setting(el).setName('Your writing').setHeading();
    const candidates = folderCandidates(paragraphsByFolder(this.app), choices.sittingsFolder, settings.bankFolder);
    el.createEl('p', {
      cls: 'setting-item-description',
      text: candidates.length
        ? 'Questions can also come from what you have already written. Choose the folders that hold your own words, not clippings or other people’s writing.'
        : 'No other folder holds writing yet. You can add folders later in settings.',
    });
    for (const { folder, paragraphs } of candidates) {
      new Setting(el).setName(folder).setDesc(reachLabel(paragraphs)).addToggle((t) => t
        .setValue(choices.writingFolders.includes(folder))
        .onChange((on) => {
          choices.writingFolders = on ? [...choices.writingFolders, folder] : choices.writingFolders.filter((f) => f !== folder);
        }));
    }

    // 3. Questions other people wrote.
    new Setting(el).setName('Question banks').setHeading();
    for (const bank of STARTER_BANK) {
      const have = exists(bank.name);
      new Setting(el).setName(bank.title)
        .setDesc(`${bank.description} ${questionCount([bank])} questions.${have ? ' Already in your vault.' : ''}`)
        .addToggle((t) => t.setValue(choices.banks.includes(bank.name)).setDisabled(have).onChange((on) => {
          choices.banks = on ? [...choices.banks, bank.name] : choices.banks.filter((b) => b !== bank.name);
        }));
    }

    // 4. The model.
    new Setting(el).setName('AI questions').setHeading();
    const at = probes.find((p) => p.baseUrl === choices.ai.baseUrl.replace(/\/+$/, ''));
    const found = at?.kind === 'found' ? at : null;
    new Setting(el).setName('Generate questions with AI')
      .setDesc(at ? probeLine(at, choices.ai.model) : 'No AI server was checked.')
      .addToggle((t) => t.setValue(choices.ai.enableModel).onChange((on) => { choices.ai.enableModel = on; }));
    if (found && found.models.length > 1) {
      new Setting(el).setName('Model').addDropdown((d) => {
        for (const m of found.models) d.addOption(m, m);
        d.setValue(choices.ai.model).onChange((m) => { choices.ai.model = m; });
      });
    }

    new Setting(el)
      .addButton((b) => b.setButtonText('Start writing').setCta().onClick(() => {
        b.setDisabled(true);
        void this.start(choices).catch((e: unknown) => {
          new Notice(e instanceof Error ? e.message : String(e));
          b.setDisabled(false);
        });
      }))
      .addButton((b) => b.setButtonText('Not now').onClick(() => this.close()));
  }

  private async start(choices: SetupChoices): Promise<void> {
    Object.assign(this.host.settings, applySetup(this.host.settings, choices));
    await this.host.saveSettings();
    const banks = STARTER_BANK.filter((b) => choices.banks.includes(b.name));
    if (banks.length) new Notice(installedLine(await installBank(this.app, this.host.settings.bankFolder, banks), this.host.settings.bankFolder));
    this.started = true;
    this.close();
    this.done();
  }

  /** Either answer is the end of the offer; the command stays for later. */
  override onClose(): void {
    this.contentEl.empty();
    if (this.started) return;
    this.host.settings.starterOffered = true;
    void this.host.saveSettings().then(() => new Notice('Set up keep-writing is in the command palette whenever you want it.'));
  }
}
