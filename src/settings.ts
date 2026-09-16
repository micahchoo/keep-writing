// Plugin settings and the settings tab.

import { PluginSettingTab, Setting } from 'obsidian';
import type { App, Plugin } from 'obsidian';

export interface KeepWritingSettings {
  /** OpenAI-compatible endpoint base URL for bonsai. */
  baseUrl: string;
  /** Model id sent to the endpoint. */
  model: string;
  /** When off, follow-ups and Proposals are not attempted. */
  enableModel: boolean;
  /** Folder that holds Sittings (daily notes). */
  sittingsFolder: string;
  /** Folder that holds Bank notes. */
  bankFolder: string;
}

export const DEFAULT_SETTINGS: KeepWritingSettings = {
  baseUrl: 'http://127.0.0.1:8088/v1',
  model: 'bonsai-27b',
  enableModel: true,
  sittingsFolder: 'Sittings',
  bankFolder: 'Bank',
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

    new Setting(containerEl).setName('Model').setHeading();

    new Setting(containerEl)
      .setName('Use the local model')
      .setDesc('Compose follow-ups and Proposals with bonsai. Off: the plugin only draws from the Bank.')
      .addToggle((t) =>
        t.setValue(s.enableModel).onChange((v) => {
          s.enableModel = v;
          save();
        }),
      );

    new Setting(containerEl)
      .setName('Endpoint base URL')
      .setDesc('OpenAI-compatible endpoint. Local only.')
      .addText((t) =>
        t.setValue(s.baseUrl).onChange((v) => {
          s.baseUrl = v.trim() || DEFAULT_SETTINGS.baseUrl;
          save();
        }),
      );

    new Setting(containerEl)
      .setName('Model id')
      .addText((t) =>
        t.setValue(s.model).onChange((v) => {
          s.model = v.trim() || DEFAULT_SETTINGS.model;
          save();
        }),
      );
  }
}

function stripSlashes(v: string): string {
  return v.trim().replace(/^\/+|\/+$/g, '');
}
