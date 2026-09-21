// Block refs: `Path/Note#^id` <-> { path, blockId }. Resolution and block
// text go through metadataCache; nothing here parses markdown.

import type { App, CachedMetadata, FrontmatterLinkCache, TFile } from 'obsidian';
import { WorkBudget } from './work';

export interface Ref {
  /** Link path as written, without `.md`: `Sittings/2026-09-13`. */
  path: string;
  /** Block id without the caret. Absent for a note-level ref. */
  blockId?: string;
}

/**
 * The property a frontmatter link was written under. Obsidian keys a scalar
 * property by its name (`about`) and each entry of a list property by its
 * index (`answers.0`, `answers.1`), so the name is everything before the
 * first dot. Four modules used to spell this rule out for themselves, in
 * three different shapes; a relation, a Target and both readings of
 * answered-ness all depend on getting it right.
 */
export function propertyName(key: string): string {
  return key.split('.')[0] ?? key;
}

/** The frontmatter links of one property, scalar or list, in the order the cache holds them. */
export function linksNamed(cache: CachedMetadata | null, name: string): FrontmatterLinkCache[] {
  return (cache?.frontmatterLinks ?? []).filter((fl) => propertyName(fl.key) === name);
}

/**
 * The ref a named frontmatter property points at: the link cache's reading
 * when Obsidian saw a wikilink, the bare string when it did not. A list
 * property answers with its first entry.
 *
 * Two properties are read this way and they want the same reading: `about` on
 * a Sitting (target.ts) and `next` on the note a Bookmark landed on
 * (closing.ts). Before 2026-09-17 only the first existed and spelled the rule
 * out for itself.
 */
export function refNamed(cache: CachedMetadata | null, name: string): Ref | null {
  const fl = linksNamed(cache, name)[0];
  const raw = fl?.link ?? stringProp(cache?.frontmatter?.[name]);
  return raw ? parseRef(raw) : null;
}

function stringProp(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

/** Parse `Path/Note#^id`, `[[Path/Note#^id]]`, or `[[Path/Note#^id|alias]]`. */
export function parseRef(text: string): Ref | null {
  let t = text.trim();
  if (t.startsWith('[[') && t.endsWith(']]')) t = t.slice(2, -2);
  const pipe = t.indexOf('|');
  if (pipe >= 0) t = t.slice(0, pipe);
  const hash = t.indexOf('#');
  if (hash < 0) {
    return t ? { path: t } : null;
  }
  const path = t.slice(0, hash);
  const sub = t.slice(hash + 1);
  if (!path) return null;
  if (sub.startsWith('^') && sub.length > 1) return { path, blockId: sub.slice(1) };
  // A heading subpath: keep the note, drop the heading.
  return { path };
}

export function formatRef(ref: Ref): string {
  return ref.blockId ? `${ref.path}#^${ref.blockId}` : ref.path;
}

export function wikilink(ref: Ref): string {
  return `[[${formatRef(ref)}]]`;
}

/** A ref that points at a file (and optionally one of its blocks). */
export function refOf(file: TFile, blockId?: string): Ref {
  const path = file.extension === 'md' ? file.path.slice(0, -3) : file.path;
  return blockId ? { path, blockId } : { path };
}

export interface Resolved {
  file: TFile;
  blockId?: string;
}

export function resolveRef(app: App, ref: Ref, sourcePath = ''): Resolved | null {
  const file = app.metadataCache.getFirstLinkpathDest(ref.path, sourcePath);
  if (!file) return null;
  return ref.blockId ? { file, blockId: ref.blockId } : { file };
}

/** A stable key for a resolved ref: `vault/path.md#^id`. */
function resolvedKey(r: Resolved): string {
  return r.blockId ? `${r.file.path}#^${r.blockId}` : r.file.path;
}

/** Same as resolvedKey but from an unresolved ref; null if it does not resolve. */
export function keyOfRef(app: App, ref: Ref, sourcePath = ''): string | null {
  const r = resolveRef(app, ref, sourcePath);
  return r ? resolvedKey(r) : null;
}

/** One block of a note that carries an id, as text. */
export interface BlockText {
  id: string;
  /** First line of the block, 0-based. */
  line: number;
  /** The block, its id and any list marker stripped. Never empty. */
  text: string;
}

/**
 * Every block of a note that carries an id, in file order, as text. One read
 * and one split however many blocks there are.
 *
 * This used to be `blockText(app, file, id)`, which read and split the whole
 * file to return ONE block, and both callers wanted all of them. Counted
 * 2026-09-16 in this vault: 83 Pieces holding 1115 block ids, so filling the
 * paragraph jar — which happens on every draw, so on every Skip and every
 * Accept — split about 7 MB of text to produce 1115 strings. A block whose
 * text is empty once stripped is dropped, which is what both callers did.
 */
export async function blockTexts(app: App, file: TFile, budget = new WorkBudget()): Promise<BlockText[]> {
  // Entries rather than keys: indexing a Record back by its own key is three
  // lookups the compiler cannot prove safe, so it took three `!` to say what
  // Object.entries already knows.
  const entries = Object.entries(app.metadataCache.getFileCache(file)?.blocks ?? {});
  if (entries.length === 0) return [];
  await budget.checkpoint();
  entries.sort(([, a], [, b]) => a.position.start.line - b.position.start.line);
  await budget.checkpoint();
  const content = await app.vault.cachedRead(file);
  const lines: string[] = [];
  let from = 0;
  for (;;) {
    const end = content.indexOf('\n', from);
    if (end < 0) { lines.push(content.slice(from)); break; }
    lines.push(content.slice(from, end));
    from = end + 1;
    await budget.step();
  }
  const out: BlockText[] = [];
  for (let i = 0; i < entries.length; i++) {
    await budget.step();
    const [id, block] = entries[i];
    const { start, end } = block.position;
    const text = stripBlockDecoration(lines.slice(start.line, end.line + 1).join('\n'));
    if (text) out.push({ id, line: start.line, text });
  }
  return out;
}

/** Drop the trailing ` ^id` and a leading list marker. */
export function stripBlockDecoration(text: string): string {
  return text
    .replace(/\s+\^[A-Za-z0-9-]+\s*$/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, '')
    .trim();
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 6;

/** Six lowercase alphanumerics, unique against the ids already in the file. */
export function newBlockId(cache: CachedMetadata | null, random: () => number = Math.random): string {
  const taken = new Set(Object.keys(cache?.blocks ?? {}));
  for (;;) {
    let id = '';
    for (let i = 0; i < ID_LENGTH; i++) {
      id += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)];
    }
    if (!taken.has(id)) return id;
  }
}
