// Plugin settings and the settings tab.

import { BANK_SHARE, bankNotes } from './bank';
import { bankKey, bankWeight } from './bank-mix';
import type { BankWeights } from './bank-mix';
import { BankInstallModal, NewBankModal, openBankNote } from './bank-modals';
import { DropdownComponent, ExtraButtonComponent, Notice, PluginSettingTab, TFolder } from 'obsidian';
import type { App, EventRef, Plugin, Setting, SettingDefinitionItem, SettingGroupItem, TAbstractFile } from 'obsidian';

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
  /** Relative weights by bank note path, inside bankFolder. Zero pauses a bank. */
  bankWeights: BankWeights;
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
  model: 'qwen3.8-27b',
  apiKey: '',
  bankShare: BANK_SHARE,
  bankWeights: {},
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
  private bankRows = new Map<string, Setting>();
  constructor(app: App, private host: SettingsHost) {
    super(app, host);
  }

  override getSettingDefinitions(): SettingDefinitionItem<ControlKey>[] {
    this.bankRows.clear();
    const s = this.host.settings;
    const folders = this.app.vault.getAllFolders(false).map((f) => f.path);
    const bankCount = bankNotes(this.app, s.bankFolder).length;
    return [
      {
        type: 'group',
        heading: 'Vault',
        items: [
          { name: 'Use saved questions (%)', desc: 'How often to choose a saved question instead of asking about your writing. At 70, about seven out of ten choices come from your banks. If one source has nothing available, the other is used.', aliases: ['bank share', 'frequency'], control: { type: 'slider', key: 'bankShare', defaultValue: DEFAULT_SETTINGS.bankShare * 100, min: 0, max: 100, step: 5 } },
          {
            name: 'Daily notes folder',
            desc: "Where your daily notes are. Questions go into today's note.",
            aliases: ['sittings', 'journal', 'diary'],
            control: { type: 'dropdown', key: 'sittingsFolder', defaultValue: DEFAULT_SETTINGS.sittingsFolder, options: folderOptions(folders, [s.sittingsFolder, DEFAULT_SETTINGS.sittingsFolder]) },
          },
          {
            name: 'Question bank folder',
            desc: 'Where your collections of saved questions live. Each bank is a note you can open and edit.',
            aliases: ['bank'],
            control: { type: 'dropdown', key: 'bankFolder', defaultValue: DEFAULT_SETTINGS.bankFolder, options: folderOptions(folders, [s.bankFolder, DEFAULT_SETTINGS.bankFolder]) },
          },
          {
            name: 'Ask about writing in',
            desc:
              'Choose the notes you want questions about. Your daily notes are included by default. Add other folders to include more of your writing.',
            aliases: ['pieces', 'corpus', 'paragraphs', 'draw', 'writing folders'],
            render: (setting: Setting) => this.writingFolders(setting, folders),
          },
        ],
      },
      {
        type: 'group',
        heading: 'Question banks',
        items: [
          {
            name: 'Install or create banks',
            desc: `A bank is a collection of saved questions. Choose from the included banks, or get instructions to make your own. To import a finished bank, put its .md file in ${s.bankFolder}.`,
            aliases: ['import', 'prompts', 'ordinary life', 'rubric', 'agent instructions'],
            render: (setting: Setting) => {
              setting.addButton(button => button.setButtonText('Install banks').onClick(() => {
                new BankInstallModal(this.app, s.bankFolder, () => this.update()).open();
              }));
              setting.addButton(button => button.setButtonText('Create a bank').onClick(() => {
                new NewBankModal(this.app, s.bankFolder, () => this.update()).open();
              }));
            },
          },
          {
            type: 'page',
            name: 'Installed banks',
            desc: `${bankCount} ${bankCount === 1 ? 'bank' : 'banks'}. Choose how often each one appears, pause a bank, or open its note.`,
            items: [
              {
                type: 'group',
                items: [
                  {
                    name: 'How often each bank appears',
                    desc: 'Higher numbers make a bank appear more often: 20 is twice as often as 10. Set 0 to pause it. Percentages assume every bank has unanswered questions; when one runs out, the others take its place.',
                    aliases: ['ratio', 'frequency', 'weight', 'defaults'],
                    render: (setting: Setting) => {
                      setting.addButton(button => button.setButtonText('Restore default frequencies').onClick(() => {
                        this.host.settings.bankWeights = {};
                        void this.host.saveSettings().then(() => this.update()).catch(showSettingsError);
                      }));
                    },
                  },
                  ...this.bankSettings(),
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'group',
        heading: 'AI questions',
        items: [
          {
            name: 'Generate questions with AI',
            desc:
              'Create follow-up questions and questions about your notes. Requires an AI server connection below. Saved questions still work when this is off.',
            control: { type: 'toggle', key: 'enableModel', defaultValue: DEFAULT_SETTINGS.enableModel },
          },
          {
            name: 'Server address',
            desc:
              'Connect to a server with an OpenAI-compatible API. The default address looks for one running on this device. The writing used for a question is sent to this server.',
            aliases: ['url', 'ollama', 'openai', 'server'],
            control: {
              type: 'text',
              key: 'baseUrl',
              defaultValue: DEFAULT_SETTINGS.baseUrl,
              validate: (v) => (isEndpoint(v) ? undefined : 'Enter a full address starting with http:// or https://, such as http://localhost:11434/v1.'),
              disabled: () => !this.host.settings.enableModel,
            },
          },
          {
            name: 'Model name',
            desc:
              'Enter the exact name of a model available on your server. Check your server’s model list if you are unsure.',
            control: {
              type: 'text',
              key: 'model',
              defaultValue: DEFAULT_SETTINGS.model,
              disabled: () => !this.host.settings.enableModel,
            },
          },
          {
            name: 'Response length limit',
            desc: 'Maximum AI response size, measured in tokens (parts of words). Raise this if responses are cut short.',
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
              'Enter a key if your server requires one. Saved in Obsidian’s secret storage on this device.',
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

  private bankSettings(): SettingGroupItem<ControlKey>[] {
    const { bankFolder } = this.host.settings;
    const notes = bankNotes(this.app, bankFolder).sort((a, b) => a.path.localeCompare(b.path));
    if (notes.length === 0) return [{ name: 'No banks installed', desc: 'Go back to install a bank, or add a bank note to your question bank folder.' }];
    return notes.map(file => {
      const key = bankKey(file.path, bankFolder);
      return {
        name: file.basename,
        desc: this.bankDescription(key, notes.map(note => bankKey(note.path, bankFolder))),
        aliases: [key, 'bank weight', 'draw ratio'],
        render: (setting: Setting) => {
          this.bankRows.set(key, setting);
          setting.addSlider(slider => slider.setLimits(0, 100, 5)
            .setValue(bankWeight(key, this.host.settings.bankWeights)).onChange(value => {
              this.host.settings.bankWeights = { ...this.host.settings.bankWeights, [key]: value };
              const keys = notes.map(note => bankKey(note.path, bankFolder));
              for (const [rowKey, row] of this.bankRows) row.setDesc(this.bankDescription(rowKey, keys));
              void this.host.saveSettings().catch(showSettingsError);
            }));
          setting.addExtraButton(button => button.setIcon('file-text').setTooltip('Open bank note').onClick(() => {
            void openBankNote(this.app, file).catch(showSettingsError);
          }));
        },
      };
    });
  }

  private bankDescription(key: string, keys: string[]): string {
    const weights = this.host.settings.bankWeights;
    const weight = bankWeight(key, weights);
    const total = keys.reduce((sum, name) => sum + bankWeight(name, weights), 0);
    if (total === 0) return `${key} · Paused. All banks are paused; draws can still use your writing.`;
    return `${key} · ${weight === 0 ? 'Paused' : `${Math.round(weight / total * 100)}% of saved questions`}.`;
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
        return Math.round(s.bankShare * 100);
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
        this.update();
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
        s.bankShare = normalizeBankShare(typeof value === 'number' ? value / 100 : value);
        break;
      case 'apiKey':
        s.apiKey = text.trim();
        break;
    }
    return this.host.saveSettings();
  }
}

function showSettingsError(error: unknown): void {
  new Notice(error instanceof Error ? error.message : String(error));
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

/** Imported notes become selectable as soon as Obsidian indexes their frontmatter. */
export function keepBanksFresh(app: App, host: SettingsHost, tab: { update(): void }, register: (ref: EventRef) => void): void {
  let known = '';
  const refresh = () => {
    const paths = bankNotes(app, host.settings.bankFolder).map(file => file.path).sort().join('\n');
    if (paths === known) return;
    known = paths;
    tab.update();
  };
  app.workspace.onLayoutReady(refresh);
  register(app.metadataCache.on('changed', file => {
    if (bankKey(file.path, host.settings.bankFolder)) refresh();
  }));
  register(app.vault.on('delete', file => {
    if (file instanceof TFolder || bankKey(file.path, host.settings.bankFolder)) refresh();
  }));
  register(app.vault.on('rename', (file, oldPath) => {
    const { bankFolder, bankWeights } = host.settings;
    const oldKey = bankKey(oldPath, bankFolder);
    const newKey = bankKey(file.path, bankFolder);
    if (!oldKey && !newKey && !(file instanceof TFolder)) return;
    if (oldKey && newKey && (Object.hasOwn(bankWeights, oldKey) || bankNotes(app, bankFolder).some(note => note.path === file.path))) {
      const next = { ...bankWeights, [newKey]: bankWeight(oldKey, bankWeights) };
      delete next[oldKey];
      host.settings.bankWeights = next;
      void host.saveSettings().catch(showSettingsError);
    }
    refresh();
  }));
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
