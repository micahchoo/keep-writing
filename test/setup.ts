// The `obsidian` package ships types only; give bun a runtime shape for the
// few values modules import at runtime (Notice). Pure functions under test
// never touch it.
import { plugin } from 'bun';
import { mock } from 'bun:test';

// The browser timer used to yield large draws; Bun supplies the same timer API.
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });

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
  PluginSettingTab: class {
    display(): void {}
    update(): void {}
  },
  Setting: class {},
  DropdownComponent: class {},
  ExtraButtonComponent: class {},
  MarkdownView: class {},
  // Desktop unless a test says otherwise; main.ts reads this to go flat.
  Platform: { isDesktop: true, isMobile: false, isDesktopApp: true, isMobileApp: false, isPhone: false, isTablet: false },
  TFile: class {},
  TFolder: class {},
  setIcon: () => {},
  debounce: (fn: (...a: unknown[]) => void) => fn,
  // The real thing, not a pass-through: a mock that handed the path back
  // unchanged would make every test about path handling a lie. Matches the
  // documented behaviour — collapse `\` and repeated `/` to one `/`, drop
  // leading and trailing slashes, turn non-breaking spaces into spaces, then
  // String.prototype.normalize.
  normalizePath: (path: string) =>
    path.replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '').replace(/\u00A0/g, ' ').normalize(),
  MarkdownRenderer: { render: async () => {} },
  requestUrl: async () => ({ status: 0, text: '' }),
}));
