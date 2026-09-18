// Plugin settings and the settings tab.

import { PluginSettingTab, Setting } from 'obsidian';
import type { App, Plugin } from 'obsidian';

export interface KeepWritingSettings {
  /** OpenAI-compatible endpoint base URL for bonsai. */
  baseUrl: string;
  /** Model id sent to the endpoint. */
  model: string;
  /**
   * Bearer token for the endpoint. Empty for a local server, which is the
   * default: nothing configured, nothing leaves the machine. Stored in
   * `data.json` in the vault, in plain text, like every Obsidian setting.
   */
  apiKey: string;
  /** When off, follow-ups and Proposals are not attempted. */
  enableModel: boolean;
  /** Folder that holds Sittings (daily notes). */
  sittingsFolder: string;
  /** Folder that holds Bank notes. */
  bankFolder: string;
  /**
   * Folders whose paragraphs the draw may reach. The daily notes folder is in
   * here by default, so the owner's own answers come back to them; a folder of
   * finished writing is the other thing most people add.
   *
   * This was the compiled-in name `Pieces` until 2026-09-17, which is a folder
   * only this vault has.
   */
  writingFolders: string[];
  /**
   * Whether the starter Bank has been offered. Set by EITHER answer, so the
   * offer is made once and never again; the command stays in the palette for
   * anyone who said no and changed their mind.
   */
  starterOffered: boolean;
}

export const DEFAULT_SETTINGS: KeepWritingSettings = {
  baseUrl: 'http://127.0.0.1:8088/v1',
  model: 'bonsai-2-27b',
  apiKey: '',
  enableModel: true,
  sittingsFolder: 'Sittings',
  bankFolder: 'Bank',
  writingFolders: ['Sittings'],
  starterOffered: false,
};

export interface SettingsHost extends Plugin {
  settings: KeepWritingSettings;
  saveSettings(): Promise<void>;
}

export class KeepWritingSettingTab extends PluginSettingTab {
  constructor(app: App, private host: SettingsHost) {
    super(app, host);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.host.settings;
    const save = () => void this.host.saveSettings();

    new Setting(containerEl).setName('Vault').setHeading();

    new Setting(containerEl)
      .setName('Sittings folder')
      .setDesc('Daily notes live here. A note in this folder is a Sitting.')
      .addText((t) =>
        t.setValue(s.sittingsFolder).onChange((v) => {
          s.sittingsFolder = stripSlashes(v) || DEFAULT_SETTINGS.sittingsFolder;
          save();
        }),
      );

    new Setting(containerEl)
      .setName('Bank folder')
      .setDesc('Question notes live here, one per channel.')
      .addText((t) =>
        t.setValue(s.bankFolder).onChange((v) => {
          s.bankFolder = stripSlashes(v) || DEFAULT_SETTINGS.bankFolder;
          save();
        }),
      );

    new Setting(containerEl)
      .setName('Draw your own writing from')
      .setDesc(
        'One folder per line. Every paragraph in these folders that carries a block id ' +
          '(` ^abc123`) can be drawn, and the model turns it into a question about your ' +
          'life now. Your daily notes folder is here by default, so your own answers come ' +
          'back to you; add a folder of finished pieces and the plugin reaches into those ' +
          'too. Nothing outside these folders is ever read. A note with `status: page` in ' +
          'its frontmatter is skipped.',
      )
      .addTextArea((t) =>
        t.setValue(s.writingFolders.join('\n')).onChange((v) => {
          s.writingFolders = parseFolders(v);
          save();
        }),
      );

    new Setting(containerEl).setName('Model').setHeading();

    new Setting(containerEl)
      .setName('Use a model')
      .setDesc(
        'Compose questions from your own writing. Off: the plugin draws from the Bank ' +
          'only, and makes no network call at all.',
      )
      .addToggle((t) =>
        t.setValue(s.enableModel).onChange((v) => {
          s.enableModel = v;
          save();
        }),
      );

    new Setting(containerEl)
      .setName('Endpoint base URL')
      .setDesc(
        'Any OpenAI-compatible endpoint. The default is a server on this machine, so ' +
          'nothing you write leaves it. Point this somewhere else and your paragraphs go ' +
          'there instead — that is the whole of what changes.',
      )
      .addText((t) =>
        t.setValue(s.baseUrl).onChange((v) => {
          s.baseUrl = v.trim() || DEFAULT_SETTINGS.baseUrl;
          save();
        }),
      );

    new Setting(containerEl)
      .setName('Model id')
      .setDesc('Sent to that endpoint as the model name.')
      .addText((t) =>
        t.setValue(s.model).onChange((v) => {
          s.model = v.trim() || DEFAULT_SETTINGS.model;
          save();
        }),
      );

    new Setting(containerEl)
      .setName('API key')
      .setDesc(
        'Sent as a bearer token. Leave it empty for a local server, which needs none. ' +
          'It is kept in plain text in this vault, at ' +
          '.obsidian/plugins/keep-writing/data.json, like every Obsidian setting — so ' +
          'do not commit that file to a public repository.',
      )
      .addText((t) => {
        t.inputEl.type = 'password';
        t.setPlaceholder('none').setValue(s.apiKey).onChange((v) => {
          s.apiKey = v.trim();
          save();
        });
      });
  }
}

function stripSlashes(v: string): string {
  return v.trim().replace(/^\/+|\/+$/g, '');
}

/** Pure: one folder per line, blank lines and stray slashes dropped. */
export function parseFolders(v: string): string[] {
  return [...new Set(v.split('\n').map(stripSlashes).filter(Boolean))];
}
