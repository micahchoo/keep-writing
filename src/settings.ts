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
   * `data.json` in the vault, in plain text, like every Obsidian setting.
   */
  apiKey: string;
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
          {
            name: 'Sittings folder',
            desc: "Where your daily notes live. Drawn questions land in today's note here, and one is made from `Templates/Sitting.md` if today has none. Point it at the folder you already use.",
            control: { type: 'folder', key: 'sittingsFolder', defaultValue: DEFAULT_SETTINGS.sittingsFolder },
          },
          {
            name: 'Bank folder',
            desc: 'Where question notes live. The starter bank is written here, and every question the plugin can draw is read from here. Change it only if you keep them somewhere else.',
            control: { type: 'folder', key: 'bankFolder', defaultValue: DEFAULT_SETTINGS.bankFolder },
          },
          {
            name: 'Draw your own writing from',
            desc:
              'One folder per line. Every paragraph in them can become a question about your life ' +
              'now. Your daily notes are here already, so your own answers come back to you; add a ' +
              'folder of finished writing to widen what the plugin reaches. Nothing outside these ' +
              'folders is ever read, and a note with `status: page` is skipped.',
            aliases: ['pieces', 'corpus', 'paragraphs'],
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
              'Off: no network call is made at all. You keep the draw, the Ask and the linking, ' +
              'and lose only the questions composed from your own writing.',
            control: { type: 'toggle', key: 'enableModel', defaultValue: DEFAULT_SETTINGS.enableModel },
          },
          {
            name: 'Endpoint',
            desc:
              'Any OpenAI-compatible server. The default is one on this machine, so nothing you ' +
              'write leaves it — Ollama is `http://localhost:11434/v1`. Point this elsewhere and ' +
              'the paragraphs it composes from go there instead.',
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
              'Must name a model your server actually has — `ollama list` prints them. A name it ' +
              'does not know fails every composition, with nothing to see but a line in the ' +
              'developer console.',
            control: {
              type: 'text',
              key: 'model',
              defaultValue: DEFAULT_SETTINGS.model,
              disabled: () => !this.host.settings.enableModel,
            },
          },
          {
            name: 'Reply budget',
            desc:
              'A ceiling on the reply, not a target: a model that stops early costs only what it ' +
              'wrote, so headroom is nearly free. Raise it if you get no questions and no error — ' +
              'most models now think before they answer, and that thinking comes out of this budget.',
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
              'Only if your endpoint needs one; a server on this machine does not. Kept in plain ' +
              // Obsidian's configuration folder only has its default name until
              // the owner renames it, which they may. A sentence that names the
              // default sends them looking in a folder that is not there.
              `text in \`${this.app.vault.configDir}/plugins/keep-writing/data.json\`, like every ` +
              'Obsidian setting, so keep that file out of a public repository.',
            aliases: ['token', 'bearer', 'secret'],
            // Rendered by hand, not declared: no declarative control masks its
            // input, and a key legible over a shoulder is worse than a setting
            // that is one line longer here.
            render: (setting: Setting) => {
              setting.addText((t) => {
                t.inputEl.type = 'password';
                t.setPlaceholder('none')
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
      case 'apiKey':
        s.apiKey = text.trim();
        break;
    }
    return this.host.saveSettings();
  }
}

/** Every setting the tab binds. `starterOffered` is not one: nothing shows it. */
type ControlKey =
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
