// The `obsidian` package ships types only; give bun a runtime shape for the
// few values modules import at runtime (Notice). Pure functions under test
// never touch it.
import { mock } from 'bun:test';

mock.module('obsidian', () => ({
  Notice: class {
    constructor(public message: string) {}
  },
  ItemView: class {},
  FuzzySuggestModal: class {},
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
  MarkdownView: class {},
  TFile: class {},
  TFolder: class {},
  setIcon: () => {},
  debounce: (fn: (...a: unknown[]) => void) => fn,
  moment: () => ({ format: () => '2026-09-13' }),
  MarkdownRenderer: { render: async () => {} },
  requestUrl: async () => ({ status: 0, text: '' }),
}));
