// Plugin settings and the settings tab.

import { PluginSettingTab } from 'obsidian';
import type { App, Plugin, Setting, SettingDefinitionItem } from 'obsidian';

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

export const DEFAULT_SETTINGS: KeepWritingSettings = {
  baseUrl: 'http://127.0.0.1:8088/v1',
  model: 'bonsai-2-27b',
  apiKey: '',
  bankShare: 0.7,
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
 * The two folder fields are real folder pickers now. That is the change worth
 * having: naming folders is most of what this tab does, and a free-text field
 * takes a name no folder has and says nothing.
 */
export class KeepWritingSettingTab extends PluginSettingTab {
  constructor(app: App, private host: SettingsHost) {
    super(app, host);
  }

  override getSettingDefinitions(): SettingDefinitionItem<ControlKey>[] {
    return [
      {
        type: 'group',
        heading: 'Vault',
        items: [
          { name: 'Bank share', desc: 'Share of draws from the question bank: 0 means writing only, 1 means bank only. An empty jar falls back to the other.', control: { type: 'slider', key: 'bankShare', defaultValue: 0.7, min: 0, max: 1, step: 0.05 } },
          {
            name: 'Daily notes folder',
            desc: "Where your daily notes are. Questions go into today's note.",
            aliases: ['sittings', 'journal', 'diary'],
            control: { type: 'folder', key: 'sittingsFolder', defaultValue: DEFAULT_SETTINGS.sittingsFolder },
          },
          {
            name: 'Question bank folder',
            desc: 'Where the questions are kept. They are ordinary notes — edit them, delete them, add your own.',
            aliases: ['bank'],
            control: { type: 'folder', key: 'bankFolder', defaultValue: DEFAULT_SETTINGS.bankFolder },
          },
          {
            name: 'Ask about writing in',
            desc:
              'One folder per line. The plugin reads what you wrote there and asks you about it. ' +
              'Your daily notes are included already; add a folder of finished writing for ' +
              'questions about that. Nothing outside these folders is read.',
            aliases: ['pieces', 'corpus', 'paragraphs', 'draw'],
            control: {
              type: 'textarea',
              key: 'writingFolders',
              rows: 4,
              defaultValue: DEFAULT_SETTINGS.writingFolders.join('\n'),
            },
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

  /**
   * Both halves of the binding, written out rather than inherited, because two
   * of these keys are not what they look like: `writingFolders` is a list
   * behind a textarea, and a folder field that the owner empties must fall
   * back to the default rather than storing '' and reaching nothing.
   */
  override getControlValue(key: string): unknown {
    const s = this.host.settings;
    switch (key as ControlKey) {
      case 'writingFolders':
        return s.writingFolders.join('\n');
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
        s.writingFolders = parseFolders(text);
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
        s.bankShare = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.7;
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

/** Pure: one folder per line, blank lines and stray slashes dropped. */
export function parseFolders(v: string): string[] {
  return [...new Set(v.split('\n').map(stripSlashes).filter(Boolean))];
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
