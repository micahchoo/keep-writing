// The Links pane: typed links out of and into the active note, grouped by
// relation. Rows pointing at the block under the cursor are highlighted.

import { ItemView, MarkdownView, debounce, setIcon } from 'obsidian';
import type { TFile, WorkspaceLeaf } from 'obsidian';
import { paragraphAt } from './blocks';
import { INVERSE, linksOf, unlinkBoth } from './links';
import type { TypedLink } from './links';
import { formatRef, refOf } from './refs';
import type { KeepWritingSettings } from './settings';

export const LINKS_VIEW = 'keep-writing-links';

export class LinksView extends ItemView {
  private file: TFile | null = null;
  private cursorBlock: string | undefined;
  private readonly onCursor = debounce(() => this.readCursor(), 150, true);

  constructor(leaf: WorkspaceLeaf, private settings: KeepWritingSettings) {
    super(leaf);
  }

  getViewType(): string {
    return LINKS_VIEW;
  }
  getDisplayText(): string {
    return 'Links';
  }
  override getIcon(): string {
    return 'link';
  }

  override async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.track()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.track()));
    this.registerEvent(this.app.metadataCache.on('changed', (f) => f.path === this.file?.path && this.render()));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.render()));
    this.registerEvent(this.app.workspace.on('editor-change', () => this.onCursor()));
    this.registerDomEvent(document, 'selectionchange', () => this.onCursor());
    this.track();
  }

  private markdownView(): MarkdownView | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView);
  }

  private track(): void {
    const view = this.markdownView();
    const changed = !!view?.file && view.file.path !== this.file?.path;
    if (view?.file) this.file = view.file;
    if (view) this.cursorBlock = this.blockUnderCursor();
    if (changed || !this.contentEl.hasChildNodes()) this.render();
  }

  /**
   * The cursor moved in the editor. A click inside this pane also clears the
   * document selection and takes the active leaf, so `selectionchange` fires
   * with no markdown view — there the cursor did not move. Rendering on that
   * empties `contentEl` between mousedown and mouseup and swallows the click,
   * which made the x and the ref links need a second click.
   */
  private readCursor(): void {
    if (!this.markdownView()) return;
    const block = this.blockUnderCursor();
    if (block === this.cursorBlock) return;
    this.cursorBlock = block;
    this.render();
  }

  private blockUnderCursor(): string | undefined {
    const view = this.markdownView();
    if (!view?.file || view.file.path !== this.file?.path) return undefined;
    const cache = this.app.metadataCache.getFileCache(view.file);
    return paragraphAt(cache, view.editor.getCursor().line)?.id;
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('kw-links');
    if (!this.file) {
      root.createEl('p', { text: 'Open a note to see its links.', cls: 'kw-muted' });
      return;
    }
    root.createEl('div', { text: this.file.basename, cls: 'kw-title' });

    const links = linksOf(this.app, this.file);
    if (links.length === 0) {
      root.createEl('p', { text: 'No typed links yet.', cls: 'kw-muted' });
      return;
    }
    const groups = new Map<string, TypedLink[]>();
    for (const l of links) {
      const name = l.direction === 'out' ? l.relation : INVERSE[l.relation];
      const g = groups.get(name);
      if (g) g.push(l);
      else groups.set(name, [l]);
    }
    for (const [name, rows] of groups) {
      const section = root.createDiv({ cls: 'kw-group' });
      section.createEl('div', { text: name, cls: 'kw-group-name' });
      for (const row of rows) this.renderRow(section, row);
    }
  }

  private renderRow(parent: HTMLElement, link: TypedLink): void {
    const el = parent.createDiv({ cls: 'kw-row' });
    if (this.cursorBlock && link.ownBlockId === this.cursorBlock) el.addClass('is-here');
    const arrow = el.createSpan({ cls: 'kw-arrow' });
    setIcon(arrow, link.direction === 'out' ? 'arrow-right' : 'arrow-left');
    const a = el.createEl('a', { text: formatRef(link.ref), cls: 'kw-ref internal-link' });
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      void this.app.workspace.openLinkText(formatRef(link.ref), this.file?.path ?? '', ev.ctrlKey || ev.metaKey);
    });
    if (link.ownBlockId) el.createSpan({ text: `^${link.ownBlockId}`, cls: 'kw-own' });
    const remove = el.createEl('button', { cls: 'kw-remove clickable-icon', attr: { 'aria-label': 'Remove link' } });
    setIcon(remove, 'x');
    remove.addEventListener('click', () => void this.remove(link));
  }

  private async remove(link: TypedLink): Promise<void> {
    if (!this.file) return;
    const here = refOf(this.file, link.ownBlockId);
    const opts = { bankFolder: this.settings.bankFolder };
    if (link.direction === 'out') await unlinkBoth(this.app, here, link.relation, link.ref, opts);
    else await unlinkBoth(this.app, link.ref, link.relation, here, opts);
    this.render();
  }
}
