// "Link this paragraph to…": ensureBlockId under the cursor, choose a note,
// then a block in it (or the whole note), then a relation, then linkBoth.

import { FuzzySuggestModal, Notice } from 'obsidian';
import type { App, MarkdownView, TFile } from 'obsidian';
import { ensureBlockId, NotAParagraph } from './blocks';
import { INVERSE, RELATIONS, linkBoth } from './links';
import type { Relation } from './links';
import { refOf, stripBlockDecoration } from './refs';
import type { Ref } from './refs';

/**
 * A suggester that reports exactly once: the pick, or null when dismissed.
 * Obsidian calls close() before onChooseItem(), so the dismiss report is
 * deferred a tick and skipped if a pick arrived meanwhile.
 */
abstract class OnceSuggester<T> extends FuzzySuggestModal<T> {
  private reported = false;

  constructor(app: App, placeholder: string, private onPick: (v: T | null) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  onChooseItem(item: T): void {
    this.report(item);
  }

  override onClose(): void {
    setTimeout(() => this.report(null), 0);
  }

  private report(v: T | null): void {
    if (this.reported) return;
    this.reported = true;
    this.onPick(v);
  }
}

class NoteSuggester extends OnceSuggester<TFile> {
  constructor(app: App, private files: TFile[], onPick: (f: TFile | null) => void) {
    super(app, 'Link to which note?', onPick);
  }
  getItems(): TFile[] {
    return this.files;
  }
  getItemText(f: TFile): string {
    return f.path.replace(/\.md$/, '');
  }
}

interface BlockChoice {
  label: string;
  blockId?: string;
}

class BlockSuggester extends OnceSuggester<BlockChoice> {
  constructor(app: App, private choices: BlockChoice[], onPick: (c: BlockChoice | null) => void) {
    super(app, 'Which block? (or the whole note)', onPick);
  }
  getItems(): BlockChoice[] {
    return this.choices;
  }
  getItemText(c: BlockChoice): string {
    return c.label;
  }
}

class RelationSuggester extends OnceSuggester<Relation> {
  constructor(app: App, onPick: (r: Relation | null) => void) {
    super(app, 'How does this paragraph relate to it?', onPick);
  }
  getItems(): Relation[] {
    return [...RELATIONS];
  }
  getItemText(r: Relation): string {
    return `${r}  (inverse: ${INVERSE[r]})`;
  }
}

/** Open a suggester and resolve with the pick, or null on dismiss. */
function once<T>(open: (cb: (v: T | null) => void) => void): Promise<T | null> {
  return new Promise((resolve) => open(resolve));
}

async function blockChoices(app: App, file: TFile): Promise<BlockChoice[]> {
  const blocks = app.metadataCache.getFileCache(file)?.blocks ?? {};
  const ids = Object.keys(blocks);
  if (ids.length === 0) return [];
  const lines = (await app.vault.cachedRead(file)).split('\n');
  const choices: BlockChoice[] = [{ label: 'whole note' }];
  for (const id of ids) {
    const b = blocks[id]!;
    const text = stripBlockDecoration(lines.slice(b.position.start.line, b.position.end.line + 1).join(' '));
    choices.push({ label: `^${id}  ${text.slice(0, 120)}`, blockId: id });
  }
  return choices;
}

export async function linkParagraphCommand(app: App, view: MarkdownView, bankFolder: string): Promise<void> {
  const file = view.file;
  if (!file) return;
  let sourceRef: Ref;
  try {
    sourceRef = await ensureBlockId(app, file, view.editor.getCursor().line);
  } catch (e) {
    new Notice(e instanceof NotAParagraph ? e.message : String(e));
    return;
  }

  const notes = app.vault.getMarkdownFiles().filter((f) => f.path !== file.path);
  const note = await once<TFile>((cb) => new NoteSuggester(app, notes, cb).open());
  if (!note) return;

  const choices = await blockChoices(app, note);
  let targetRef: Ref = refOf(note);
  if (choices.length > 0) {
    const choice = await once<BlockChoice>((cb) => new BlockSuggester(app, choices, cb).open());
    if (!choice) return;
    targetRef = refOf(note, choice.blockId);
  }

  const relation = await once<Relation>((cb) => new RelationSuggester(app, cb).open());
  if (!relation) return;

  await linkBoth(app, sourceRef, relation, targetRef, { bankFolder });
  new Notice(`${relation} → ${targetRef.blockId ? `^${targetRef.blockId} in ` : ''}${note.basename}`);
}
