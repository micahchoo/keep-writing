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

/** One arrow per direction; a symmetric relation points both ways. */
const ARROW: Record<TypedLink['direction'], string> = {
  out: 'arrow-right',
  in: 'arrow-left',
  both: 'arrow-left-right',
};

export class LinksView extends ItemView {
  private file: TFile | null = null;
  private cursorBlock: string | undefined;
  /** What the pane last drew, as one string. The gate in front of every render. */
  private drawn = '';
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
    this.registerEvent(this.app.metadataCache.on('changed', (f) => f.path === this.file?.path && this.draw()));
    // `resolved` fires for the WHOLE vault, in batches, and almost never says
    // anything about this note. It is the reason the gate is a gate and not a
    // habit kept per listener.
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.draw()));
    this.registerEvent(this.app.workspace.on('editor-change', () => this.onCursor()));
    this.registerDomEvent(document, 'selectionchange', () => this.onCursor());
    this.track();
  }

  private markdownView(): MarkdownView | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView);
  }

  private track(): void {
    const view = this.markdownView();
    if (view?.file) this.file = view.file;
    if (view) this.cursorBlock = this.blockUnderCursor();
    this.draw();
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
    this.cursorBlock = this.blockUnderCursor();
    this.draw();
  }

  private blockUnderCursor(): string | undefined {
    const view = this.markdownView();
    if (!view?.file || view.file.path !== this.file?.path) return undefined;
    const cache = this.app.metadataCache.getFileCache(view.file);
    return paragraphAt(cache, view.editor.getCursor().line)?.id;
  }

  /**
   * Draw the pane, and ONLY when what it would draw has moved. Every listener
   * above goes through here.
   *
   * A render empties `contentEl`. Land one between a mousedown and a mouseup
   * and the element under the pointer is destroyed, so the browser dispatches
   * no click at all — the × and the ref links then need a second click. Two
   * defects of that shape were fixed one listener at a time
   * (.claude/rules/keep-writing-pane-render.md); a signature covers the
   * listeners nobody has looked at yet.
   */
  private draw(): void {
    const links = this.file ? linksOf(this.app, this.file) : [];
    const signature = JSON.stringify([
      this.file?.path ?? '',
      this.cursorBlock ?? '',
      links.map((l) => [l.relation, l.direction, formatRef(l.ref), l.otherPath, l.ownBlockId ?? '']),
    ]);
    if (signature === this.drawn && this.contentEl.hasChildNodes()) return;
    this.drawn = signature;
    this.render(links);
  }

  private render(links: TypedLink[]): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('kw-links');
    if (!this.file) {
      root.createEl('p', { text: 'Open a note to see its links.', cls: 'kw-muted' });
      return;
    }
    root.createEl('div', { text: this.file.basename, cls: 'kw-title' });

    if (links.length === 0) {
      root.createEl('p', { text: 'No typed links yet.', cls: 'kw-muted' });
      return;
    }
    const groups = new Map<string, TypedLink[]>();
    for (const l of links) {
      // A symmetric relation has one name, so `both` groups under it too.
      const name = l.direction === 'in' ? INVERSE[l.relation] : l.relation;
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
    setIcon(arrow, ARROW[link.direction]);
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
    // `both` unlinks from this end: for a symmetric relation the property
    // name is the same at both ends, so either direction removes the pair.
    if (link.direction === 'in') await unlinkBoth(this.app, link.ref, link.relation, here, opts);
    else await unlinkBoth(this.app, here, link.relation, link.ref, opts);
    this.draw();
  }
}
