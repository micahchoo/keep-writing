// Plugin settings and the settings tab.

import { BANK_SHARE } from './bank';
import { DropdownComponent, ExtraButtonComponent, PluginSettingTab, TFolder } from 'obsidian';
import type { App, EventRef, Plugin, Setting, SettingDefinitionItem, TAbstractFile } from 'obsidian';

export interface KeepWritingSettings {
  /** OpenAI-compatible endpoint base URL for bonsai. */
  baseUrl: string;
  /** Model id sent to the endpoint. */
  model: string;
  /**
   * Bearer token for the endpoint. Empty for a local server, which is the
   * default: nothing configured, nothing leaves the machine. Stored in
   * Obsidian secret storage; never written to plugin data.
   */
  apiKey: string;
  bankShare: number;
  /**
   * Ceiling on the model's reply, in tokens. A ceiling and not a target: a
   * model that stops early costs what it generated. See BonsaiConfig#maxTokens
   * for why 256 was too small to ship.
   */
  maxTokens: number;
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

/** A share between 0 and 1, or the default for anything that is not one. Read at load and at the slider. */
export function normalizeBankShare(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : BANK_SHARE;
}

export const DEFAULT_SETTINGS: KeepWritingSettings = {
  baseUrl: 'http://127.0.0.1:8088/v1',
  model: 'bonsai-2-27b',
  apiKey: '',
  bankShare: BANK_SHARE,
  maxTokens: 2048,
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

/**
 * The settings tab, declared rather than drawn.
 *
 * This built the tab imperatively in `display()` until 2026-09-17, which works
 * on every version but leaves the settings out of Obsidian's settings SEARCH:
 * the app can only index what it can read as data. `getSettingDefinitions()`
 * is that data, the base `display()` renders it, and the same array is what
 * search reads — one description of each setting, not two. It arrived in
 * 1.13.0, which is why `minAppVersion` is 1.13.0.
 *
 * Every folder is chosen from a dropdown of the vault's folders. Naming
 * folders is most of what this tab does, and anything typed can name a folder
 * that is not there and say nothing: a textarea once held `Pieces` twice and
 * no daily notes folder, and nothing on the tab showed it.
 *
 * The writing folders are a list, and no declarative control holds a list, so
 * that one row is drawn by hand like the API key. Each chosen folder shows with
 * a button to take it out, and one dropdown adds another.
 */
export class KeepWritingSettingTab extends PluginSettingTab {
  constructor(app: App, private host: SettingsHost) {
    super(app, host);
  }

  override getSettingDefinitions(): SettingDefinitionItem<ControlKey>[] {
    const s = this.host.settings;
    const folders = this.app.vault.getAllFolders(false).map((f) => f.path);
    return [
      {
        type: 'group',
        heading: 'Vault',
        items: [
          { name: 'Bank share', desc: 'Share of draws from the question bank: 0 means writing only, 1 means bank only. An empty jar falls back to the other.', control: { type: 'slider', key: 'bankShare', defaultValue: DEFAULT_SETTINGS.bankShare, min: 0, max: 1, step: 0.05 } },
          {
            name: 'Daily notes folder',
            desc: "Where your daily notes are. Questions go into today's note.",
            aliases: ['sittings', 'journal', 'diary'],
            control: { type: 'dropdown', key: 'sittingsFolder', defaultValue: DEFAULT_SETTINGS.sittingsFolder, options: folderOptions(folders, [s.sittingsFolder, DEFAULT_SETTINGS.sittingsFolder]) },
          },
          {
            name: 'Question bank folder',
            desc: 'Where the questions are kept. They are ordinary notes — edit them, delete them, add your own.',
            aliases: ['bank'],
            control: { type: 'dropdown', key: 'bankFolder', defaultValue: DEFAULT_SETTINGS.bankFolder, options: folderOptions(folders, [s.bankFolder, DEFAULT_SETTINGS.bankFolder]) },
          },
          {
            name: 'Ask about writing in',
            desc:
              'The plugin reads what you wrote in these folders and asks you about it. ' +
              'Your daily notes are included at first; add a folder of finished writing for ' +
              'questions about that. A graduated piece goes into one of them. Nothing outside these folders is read.',
            aliases: ['pieces', 'corpus', 'paragraphs', 'draw', 'writing folders'],
            render: (setting: Setting) => this.writingFolders(setting, folders),
          },
        ],
      },
      {
        type: 'group',
        heading: 'Model',
        items: [
          {
            name: 'Use a model',
            desc:
              'Turning this off keeps the question bank working and stops all network use. ' +
              'You lose only the questions written about your own writing.',
            control: { type: 'toggle', key: 'enableModel', defaultValue: DEFAULT_SETTINGS.enableModel },
          },
          {
            name: 'Endpoint',
            desc:
              'The server that writes those questions. The default runs on your own computer, so ' +
              'nothing you write leaves it. For Ollama: http://localhost:11434/v1',
            aliases: ['url', 'ollama', 'openai', 'server'],
            control: {
              type: 'text',
              key: 'baseUrl',
              defaultValue: DEFAULT_SETTINGS.baseUrl,
              validate: (v) => (isEndpoint(v) ? undefined : 'Not a URL. Expected something like http://127.0.0.1:8088/v1'),
              disabled: () => !this.host.settings.enableModel,
            },
          },
          {
            name: 'Model',
            desc:
              'Which model to use. It must be one your server already has — `ollama list` shows ' +
              'them. A wrong name means no questions appear.',
            control: {
              type: 'text',
              key: 'model',
              defaultValue: DEFAULT_SETTINGS.model,
              disabled: () => !this.host.settings.enableModel,
            },
          },
          {
            name: 'Reply budget',
            desc: 'How much the model may write at once. If no questions appear, raise it.',
            aliases: ['tokens', 'max tokens', 'length', 'empty', 'nothing happens'],
            control: {
              type: 'number',
              key: 'maxTokens',
              defaultValue: DEFAULT_SETTINGS.maxTokens,
              min: 256,
              max: 32768,
              step: 256,
              disabled: () => !this.host.settings.enableModel,
            },
          },
          {
            name: 'API key',
            desc:
              'Only if your server needs one; a server on your own computer does not. Saved as ' +
              "Obsidian secret storage on this device.",
            aliases: ['token', 'bearer', 'secret'],
            // Rendered by hand, not declared: no declarative control masks its
            // input, and a key legible over a shoulder is worse than a setting
            // that is one line longer here.
            render: (setting: Setting) => {
              setting.addText((t) => {
                t.inputEl.type = 'password';
                t.setPlaceholder('None')
                  .setValue(this.host.settings.apiKey)
                  .onChange((v) => void this.setControlValue('apiKey', v));
              });
            },
          },
        ],
      },
    ];
  }

  /** The chosen writing folders, each removable, and one dropdown to add another. */
  private writingFolders(setting: Setting, folders: string[]): void {
    const draw = () => {
      const chosen = this.host.settings.writingFolders;
      setting.controlEl.empty();
      const list = setting.controlEl.createDiv({ cls: 'kw-folders' });
      for (const folder of chosen) {
        const row = list.createDiv({ cls: 'kw-folder' });
        row.createSpan({ text: folder });
        new ExtraButtonComponent(row).setIcon('x').setTooltip(`Stop reading ${folder}`).onClick(() => {
          void this.setControlValue('writingFolders', withoutFolder(this.host.settings.writingFolders, folder)).then(draw);
        });
      }
      const addable = Object.keys(folderOptions(folders, [])).filter((f) => !chosen.includes(f));
      if (addable.length === 0) return;
      new DropdownComponent(list)
        .addOption('', 'Add a folder…')
        .addOptions(Object.fromEntries(addable.map((f) => [f, f])))
        .onChange((folder) => {
          if (folder) void this.setControlValue('writingFolders', withFolder(this.host.settings.writingFolders, folder)).then(draw);
        });
    };
    draw();
  }

  /**
   * Both halves of the binding, written out rather than inherited, because two
   * of these keys are not what they look like: `writingFolders` is a list
   * drawn by hand, and a folder the owner somehow empties must fall back to
   * the default rather than storing '' and reaching nothing.
   */
  override getControlValue(key: string): unknown {
    const s = this.host.settings;
    switch (key as ControlKey) {
      case 'writingFolders':
        return s.writingFolders;
      case 'sittingsFolder':
        return s.sittingsFolder;
      case 'bankFolder':
        return s.bankFolder;
      case 'enableModel':
        return s.enableModel;
      case 'baseUrl':
        return s.baseUrl;
      case 'model':
        return s.model;
      case 'maxTokens':
        return s.maxTokens;
      case 'bankShare':
        return s.bankShare;
      case 'apiKey':
        return s.apiKey;
    }
  }

  override setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.host.settings;
    const text = typeof value === 'string' ? value : '';
    switch (key as ControlKey) {
      case 'writingFolders':
        s.writingFolders = readFolders(value);
        break;
      case 'sittingsFolder':
        s.sittingsFolder = stripSlashes(text) || DEFAULT_SETTINGS.sittingsFolder;
        break;
      case 'bankFolder':
        s.bankFolder = stripSlashes(text) || DEFAULT_SETTINGS.bankFolder;
        break;
      case 'enableModel':
        s.enableModel = value === true;
        this.refreshDomState(); // the endpoint and model id hang off this one
        break;
      case 'baseUrl':
        s.baseUrl = text.trim() || DEFAULT_SETTINGS.baseUrl;
        break;
      case 'model':
        s.model = text.trim() || DEFAULT_SETTINGS.model;
        break;
      case 'maxTokens':
        s.maxTokens = typeof value === 'number' && value > 0 ? Math.floor(value) : DEFAULT_SETTINGS.maxTokens;
        break;
      case 'bankShare':
        s.bankShare = normalizeBankShare(value);
        break;
      case 'apiKey':
        s.apiKey = text.trim();
        break;
    }
    return this.host.saveSettings();
  }
}

/** Every setting the tab binds. `starterOffered` is not one: nothing shows it. */
type ControlKey = 'bankShare'
  | 'sittingsFolder'
  | 'bankFolder'
  | 'writingFolders'
  | 'enableModel'
  | 'baseUrl'
  | 'model'
  | 'maxTokens'
  | 'apiKey';

function stripSlashes(v: string): string {
  return v.trim().replace(/^\/+|\/+$/g, '');
}

/**
 * Pure: a stored list of folders, cleaned. Blank entries and stray slashes are
 * dropped and a folder named twice is named once, because an older version's
 * textarea or a hand edit to data.json can leave any of them, and a trailing
 * slash makes the draw reach nothing.
 */
export function readFolders(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((f): f is string => typeof f === 'string').map(stripSlashes).filter(Boolean))];
}

/**
 * Pure: a folder dropdown's options, every vault folder sorted, the root left
 * out. `keep` is offered even when no such folder exists yet — the Bank
 * folder is not there until the starter bank is written, and a dropdown that
 * cannot show the current value shows a wrong one.
 */
export function folderOptions(folders: string[], keep: string[]): Record<string, string> {
  const all = [...new Set([...folders, ...keep].map(stripSlashes).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return Object.fromEntries(all.map((f) => [f, f]));
}

/** Pure: the list with this folder in it, once. */
export function withFolder(list: string[], folder: string): string[] {
  return list.includes(folder) ? list : [...list, folder];
}

/** Pure: the list without this folder. */
export function withoutFolder(list: string[], folder: string): string[] {
  return list.filter((f) => f !== folder);
}

/**
 * Keep the folder dropdowns offering the vault's folders. Obsidian reads
 * getSettingDefinitions() once, when the tab is added — at plugin load, before
 * the vault is indexed — and draws that copy on every open; a display()
 * override is bypassed in 1.13. So the definitions are read again once the
 * vault is indexed, and whenever a folder is made, removed or renamed. A note
 * event costs one type check.
 */
export function keepFoldersFresh(app: App, tab: { update(): void }, register: (ref: EventRef) => void): void {
  app.workspace.onLayoutReady(() => {
    tab.update();
    const refresh = (file: TAbstractFile) => {
      if (file instanceof TFolder) tab.update();
    };
    register(app.vault.on('create', refresh));
    register(app.vault.on('delete', refresh));
    register(app.vault.on('rename', refresh));
  });
}

/** Pure: something the endpoint call can actually be made against. */
export function isEndpoint(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
