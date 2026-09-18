// The `obsidian` package ships types only; give bun a runtime shape for the
// few values modules import at runtime (Notice). Pure functions under test
// never touch it.
import { plugin } from 'bun';
import { mock } from 'bun:test';

// `starter/*.md` is the shipped question bank, imported as TEXT: esbuild is
// told so in esbuild.config.mjs, and bun must be told separately, because its
// own `.md` loader renders markdown to HTML. Without this the tests read the
// shipped bank as `<ul><li>…` and every assertion about it is meaningless.
plugin({
  name: 'markdown as text',
  setup(build) {
    build.onLoad({ filter: /\.md$/ }, async (args) => ({
      contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};`,
      loader: 'js',
    }));
  },
});

mock.module('obsidian', () => ({
  Notice: class {
    constructor(public message: string) {}
  },
  Modal: class {},
  SuggestModal: class {
    setPlaceholder(): void {}
  },
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
