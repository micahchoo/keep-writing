import { Modal, Notice, Setting, normalizePath } from 'obsidian';
import type { App, ButtonComponent, TFile } from 'obsidian';
import { bankInstructions, createBank } from './bank-authoring';
import { installBank, installedLine, questionCount } from './install';
import { STARTER_BANK } from './starter-bank';

/** Opening a note must also dismiss Settings, which may live in a separate window. */
export async function openBankNote(app: App, file: TFile): Promise<void> {
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  // Obsidian 1.13 exposes no public Settings dismiss method. revealLeaf and
  // window.focus leave its modal window in front (verified in 1.13.7).
  // Guard the internal close method so opening the note still works if it moves.
  const settings = (app as App & { setting?: { close?: () => void } }).setting;
  if (typeof settings?.close === 'function') settings.close();
  else new Notice('The bank note is open. Close settings to view it.');
  await app.workspace.revealLeaf(leaf);
}

/** Select before writing. Existing notes are shown but never replaced. */
export class BankInstallModal extends Modal {
  constructor(app: App, private folder: string, private installed: () => void) { super(app); }

  override onOpen(): void {
    this.setTitle('Choose question banks');
    this.contentEl.createEl('p', { text: `Choose the banks to add to ${this.folder}. You can change how often each one appears in settings. Existing notes keep your edits.` });
    const selected = new Set<string>();
    let submit: ButtonComponent | undefined;
    for (const bank of STARTER_BANK) {
      const exists = !!this.app.vault.getAbstractFileByPath(normalizePath(`${this.folder}/${bank.name}`));
      if (!exists) selected.add(bank.name);
      new Setting(this.contentEl).setName(bank.title)
        .setDesc(`${bank.description} ${questionCount([bank])} questions.${exists ? ' Already in your folder; your copy will be kept.' : ''}`)
        .addToggle(toggle => toggle.setValue(!exists).setDisabled(exists).onChange(value => {
          if (value) selected.add(bank.name); else selected.delete(bank.name);
          submit?.setDisabled(selected.size === 0);
        }));
    }
    const actions = new Setting(this.contentEl);
    actions.addButton(button => {
      submit = button;
      button.setButtonText('Install selected').setCta().setDisabled(selected.size === 0)
      .onClick(() => {
        button.setDisabled(true);
        void installBank(this.app, this.folder, STARTER_BANK.filter(bank => selected.has(bank.name)))
          .then(result => {
            new Notice(installedLine(result, this.folder));
            this.installed();
            this.close();
          }).catch((error: unknown) => {
            new Notice(error instanceof Error ? error.message : String(error));
            button.setDisabled(selected.size === 0);
          });
      });
    });
    actions.addButton(button => button.setButtonText('Cancel').onClick(() => this.close()));
  }

  override onClose(): void { this.contentEl.empty(); }
}

/** The specification stays available here and in each empty bank that is created. */
export class NewBankModal extends Modal {
  constructor(app: App, private folder: string, private created: () => void) { super(app); }

  override onOpen(): void {
    this.setTitle('Create a question bank');
    this.contentEl.createEl('p', { text: 'Choose a subject and copy the instructions to your AI assistant or coding agent. Ask it to write a bank using those instructions. You can also create an empty note here to keep the instructions for later.' });
    let name = '';
    let refresh = () => {};
    new Setting(this.contentEl).setName('Bank name').setDesc('For example: gardening, neighbourhood walks, or learning to cook.')
      .addText(text => text.setPlaceholder('My questions').onChange(value => { name = value; refresh(); }));
    const specification = this.contentEl.createEl('textarea', { cls: 'kw-bank-spec', attr: { 'aria-label': 'Instructions for your agent', readonly: 'readonly', rows: '12' } });
    refresh = () => {
      try { specification.value = bankInstructions(this.folder, name || 'My questions'); }
      catch (error) { specification.value = error instanceof Error ? error.message : String(error); }
    };
    refresh();
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('Copy instructions').onClick(() => {
        try {
          const text = bankInstructions(this.folder, name || 'My questions');
          specification.focus();
          specification.select();
          const clipboard = this.contentEl.ownerDocument.defaultView?.navigator.clipboard;
          void (clipboard ? clipboard.writeText(text) : Promise.reject(new Error('Clipboard unavailable'))).then(() => new Notice('Bank instructions copied.')).catch(() => {
            specification.focus(); specification.select();
            new Notice('Select and copy the instructions shown here.');
          });
        } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
      }))
      .addButton(button => button.setButtonText('Create and open note').setCta().onClick(() => {
        button.setDisabled(true);
        void createBank(this.app, this.folder, name).then(async file => {
          this.created();
          this.close();
          await openBankNote(this.app, file);
        }).catch((error: unknown) => {
          new Notice(error instanceof Error ? error.message : String(error));
          button.setDisabled(false);
        });
      }));
  }

  override onClose(): void { this.contentEl.empty(); }
}
