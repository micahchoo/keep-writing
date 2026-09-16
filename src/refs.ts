// Block refs: `Path/Note#^id` <-> { path, blockId }. Resolution and block
// text go through metadataCache; nothing here parses markdown.

import type { App, CachedMetadata, TFile } from 'obsidian';

export interface Ref {
  /** Link path as written, without `.md`: `Sittings/2026-09-13`. */
  path: string;
  /** Block id without the caret. Absent for a note-level ref. */
  blockId?: string;
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
export function resolvedKey(r: Resolved): string {
  return r.blockId ? `${r.file.path}#^${r.blockId}` : r.file.path;
}

/** Same as resolvedKey but from an unresolved ref; null if it does not resolve. */
export function keyOfRef(app: App, ref: Ref, sourcePath = ''): string | null {
  const r = resolveRef(app, ref, sourcePath);
  return r ? resolvedKey(r) : null;
}

/** Read the text of a block from a file, by its block id. Null if unknown. */
export async function blockText(app: App, file: TFile, blockId: string): Promise<string | null> {
  const cache = app.metadataCache.getFileCache(file);
  const block = cache?.blocks?.[blockId];
  if (!block) return null;
  const content = await app.vault.cachedRead(file);
  const lines = content.split('\n');
  const slice = lines.slice(block.position.start.line, block.position.end.line + 1);
  return stripBlockDecoration(slice.join('\n'));
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
