// Typed links: a wikilink in a frontmatter property named after the relation,
// written on both ends (forward on the source, inverse on the target). Targets
// in Bank/ get no inverse.

import type { App, TFile } from 'obsidian';
import { formatRef, parseRef, refOf, resolveRef, wikilink } from './refs';
import type { Ref } from './refs';

export const RELATIONS = ['answers', 'echoes', 'contradicts', 'follows', 'demonstrates'] as const;
export type Relation = (typeof RELATIONS)[number];

export const INVERSE: Record<Relation, string> = {
  answers: 'answered-by',
  echoes: 'echoes',
  contradicts: 'contradicts',
  follows: 'precedes',
  demonstrates: 'demonstrated-by',
};

/** Forward relation for any property name, or null if it is not a relation. */
export function relationOfKey(key: string): { relation: Relation; inverse: boolean } | null {
  const name = key.split('.')[0] ?? key;
  for (const r of RELATIONS) {
    if (name === r) return { relation: r, inverse: false };
    if (name === INVERSE[r]) return { relation: r, inverse: true };
  }
  return null;
}

export function isRelation(name: string): name is Relation {
  return (RELATIONS as readonly string[]).includes(name);
}

export function isBankPath(path: string, bankFolder: string): boolean {
  return path.startsWith(bankFolder + '/');
}

function asList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

function sameRef(a: string, b: Ref): boolean {
  const pa = parseRef(a);
  return !!pa && formatRef(pa) === formatRef(b);
}

async function addToProperty(app: App, file: TFile, key: string, ref: Ref): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    const list = asList(fm[key]);
    if (list.some((v) => sameRef(v, ref))) return;
    list.push(wikilink(ref));
    fm[key] = list;
  });
}

/**
 * Remove entries pointing at `ref`. With a blockId, only that block; without,
 * every entry that names the note (any block).
 */
async function removeFromProperty(app: App, file: TFile, key: string, ref: Ref): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    const list = asList(fm[key]);
    const keep = list.filter((v) => {
      const p = parseRef(v);
      if (!p) return true;
      if (ref.blockId) return formatRef(p) !== formatRef(ref);
      return p.path !== ref.path;
    });
    if (keep.length === list.length) return;
    if (keep.length === 0) delete fm[key];
    else fm[key] = keep;
  });
}

export interface LinkOptions {
  bankFolder: string;
}

/** Write the forward link on the source note and the inverse on the target note. */
export async function linkBoth(
  app: App,
  sourceRef: Ref,
  relation: Relation,
  targetRef: Ref,
  opts: LinkOptions,
): Promise<void> {
  const source = resolveRef(app, sourceRef);
  if (!source) throw new Error(`Source note not found: ${sourceRef.path}`);
  await addToProperty(app, source.file, relation, targetRef);

  const target = resolveRef(app, targetRef, source.file.path);
  if (!target || isBankPath(target.file.path, opts.bankFolder)) return;
  await addToProperty(app, target.file, INVERSE[relation], sourceRef);
}

export async function unlinkBoth(
  app: App,
  sourceRef: Ref,
  relation: Relation,
  targetRef: Ref,
  opts: LinkOptions,
): Promise<void> {
  const source = resolveRef(app, sourceRef);
  if (!source) return;
  await removeFromProperty(app, source.file, relation, targetRef);

  const target = resolveRef(app, targetRef, source.file.path);
  if (!target || isBankPath(target.file.path, opts.bankFolder)) return;
  await removeFromProperty(app, target.file, INVERSE[relation], sourceRef);
}

export interface TypedLink {
  relation: Relation;
  /** `out`: this note is the source. `in`: this note is the target. */
  direction: 'out' | 'in';
  /** The other end, as it must be written to address it. */
  ref: Ref;
  /** Vault path of the other note. */
  otherPath: string;
  /** Block on this note's side, when the link is block-precise here. */
  ownBlockId?: string;
}

/**
 * All typed links touching a note: its own properties (forward names are
 * out-links, inverse names are in-links) and other notes' forward properties
 * that point here. Rows describing the same link from both ends are merged.
 */
export function linksOf(app: App, file: TFile): TypedLink[] {
  const rows: TypedLink[] = [];
  const own = app.metadataCache.getFileCache(file)?.frontmatterLinks ?? [];

  for (const fl of own) {
    const rel = relationOfKey(fl.key);
    if (!rel) continue;
    const ref = parseRef(fl.link);
    const other = ref && resolveRef(app, ref, file.path);
    if (!ref || !other) continue;
    const row: TypedLink = {
      relation: rel.relation,
      direction: rel.inverse ? 'in' : 'out',
      ref,
      otherPath: other.file.path,
    };
    if (!rel.inverse) row.ownBlockId = sourceBlockFromInverse(app, other.file, rel.relation, file);
    rows.push(row);
  }

  const incoming = app.metadataCache.resolvedLinks;
  for (const sourcePath of Object.keys(incoming)) {
    if (sourcePath === file.path) continue;
    if (!incoming[sourcePath]?.[file.path]) continue;
    const src = app.vault.getFileByPath(sourcePath);
    if (!src) continue;
    for (const fl of app.metadataCache.getFileCache(src)?.frontmatterLinks ?? []) {
      const rel = relationOfKey(fl.key);
      if (!rel || rel.inverse) continue;
      const ref = parseRef(fl.link);
      const dest = ref && resolveRef(app, ref, sourcePath);
      if (!ref || !dest || dest.file.path !== file.path) continue;
      rows.push({
        relation: rel.relation,
        direction: 'in',
        ref: refOf(src),
        otherPath: sourcePath,
        ownBlockId: ref.blockId,
      });
    }
  }

  return mergeRows(rows);
}

/**
 * The same link seen from both ends yields two in-rows: the forward property
 * on the other note (knows which block here it targets) and the inverse
 * property here (knows which block there it came from). Merge rows whose
 * known fields agree.
 */
function mergeRows(rows: TypedLink[]): TypedLink[] {
  const out: TypedLink[] = [];
  const agrees = (a?: string, b?: string) => a === undefined || b === undefined || a === b;
  for (const row of rows) {
    const mate = out.find(
      (o) =>
        o.direction === row.direction &&
        o.relation === row.relation &&
        o.otherPath === row.otherPath &&
        agrees(o.ref.blockId, row.ref.blockId) &&
        agrees(o.ownBlockId, row.ownBlockId),
    );
    if (!mate) {
      out.push({ ...row });
      continue;
    }
    if (!mate.ownBlockId && row.ownBlockId) mate.ownBlockId = row.ownBlockId;
    if (!mate.ref.blockId && row.ref.blockId) mate.ref = row.ref;
  }
  return out;
}

/** The single inverse entry on `target` that names `source`, if there is exactly one. */
function sourceBlockFromInverse(
  app: App,
  target: TFile,
  relation: Relation,
  source: TFile,
): string | undefined {
  const inverse = INVERSE[relation];
  const hits: string[] = [];
  for (const fl of app.metadataCache.getFileCache(target)?.frontmatterLinks ?? []) {
    if ((fl.key.split('.')[0] ?? fl.key) !== inverse) continue;
    const ref = parseRef(fl.link);
    const dest = ref && resolveRef(app, ref, target.path);
    if (ref && dest && dest.file.path === source.path && ref.blockId) hits.push(ref.blockId);
  }
  return hits.length === 1 ? hits[0] : undefined;
}
