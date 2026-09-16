// Wells and the Target. A Well is where a paragraph comes from, for balance
// and for the Lens: the self (every paragraph no Domain gathers: Sittings, and
// the finished Pieces no Domain claims), each Domain (the Pieces it gathers
// plus its own body), each Learning note (its own body). The draw spreads
// the paragraph jar across Wells, so an untouched one surfaces.
//
// A Piece is never a Well. An open one (no `status`) has no place in the
// draw; a finished one (`status: published` or `set-down`) is drawn as
// Revisits through the Well that gathers it. A finished Piece can still be
// the Target: a day spent on it draws its own paragraphs, nothing else.

import type { App, CachedMetadata, TFile } from 'obsidian';
import { parseRef, resolveRef } from './refs';

export type WellKind = 'me' | 'domain' | 'learning';

export interface Well {
  kind: WellKind;
  /** `me`, or the note's basename. */
  name: string;
  /** Null for the self. */
  file: TFile | null;
}

/** A finished Piece named in `about`: its own paragraphs only. */
export interface PieceTarget {
  kind: 'piece';
  name: string;
  file: TFile;
}

/** What `about` on a Sitting names: one Well, or one finished Piece. */
export type Target = Well | PieceTarget;

/** Folders from CONTEXT.md, Layout. */
export const DOMAINS_FOLDER = 'Domains';
export const LEARNING_FOLDER = 'Learning';
export const PIECES_FOLDER = 'Pieces';
export const ME_BASENAME = 'me';

export const SELF: Well = { kind: 'me', name: ME_BASENAME, file: null };

export type NoteKind = WellKind | 'piece';

export function classify(file: TFile | null): NoteKind | null {
  if (!file) return null;
  if (file.basename === ME_BASENAME && !file.path.includes('/')) return 'me';
  if (file.path.startsWith(DOMAINS_FOLDER + '/')) return 'domain';
  if (file.path.startsWith(LEARNING_FOLDER + '/')) return 'learning';
  if (file.path.startsWith(PIECES_FOLDER + '/')) return 'piece';
  return null;
}

/** A Piece with a `status` (published, set-down, page) is finished. */
export function isFinishedPiece(app: App, file: TFile): boolean {
  if (classify(file) !== 'piece') return false;
  const status = app.metadataCache.getFileCache(file)?.frontmatter?.['status'];
  return typeof status === 'string' ? status.trim() !== '' : status != null;
}

/**
 * A Piece whose paragraphs are drawn as Revisits: published or set-down.
 * `status: page` marks site furniture (a resume, a section index): finished,
 * linkable, in the Proposal pool, but never put in front of the owner.
 */
export function isRevisitable(app: App, file: TFile): boolean {
  if (!isFinishedPiece(app, file)) return false;
  const status = app.metadataCache.getFileCache(file)?.frontmatter?.['status'];
  return status !== 'page';
}

/** Every Well: the self first, then each Domain and each Learning note. */
export function allWells(app: App): Well[] {
  const wells: Well[] = [SELF];
  for (const file of app.vault.getMarkdownFiles()) {
    const kind = classify(file);
    if (kind !== 'domain' && kind !== 'learning') continue;
    wells.push({ kind, name: file.basename, file });
  }
  return wells;
}

/**
 * Read `about` from a Sitting. Null when absent: the draw then roams. A link
 * to a note that is neither a Well nor a Piece narrows to the self.
 */
export function readTarget(app: App, sitting: TFile): Target | null {
  const cache = app.metadataCache.getFileCache(sitting);
  const fl = cache?.frontmatterLinks?.find((l) => l.key === 'about' || l.key.startsWith('about.'));
  const raw = fl?.original ?? stringProp(cache?.frontmatter?.['about']);
  if (!raw) return null;
  const ref = parseRef(fl?.link ?? raw);
  const file = ref ? resolveRef(app, ref, sitting.path)?.file ?? null : null;
  const kind = classify(file);
  if (!file || !kind || kind === 'me') return SELF;
  return { kind, name: file.basename, file };
}

function stringProp(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

export function isSitting(file: TFile | null, sittingsFolder: string): file is TFile {
  return !!file && file.extension === 'md' && file.path.startsWith(sittingsFolder + '/');
}

// ---------------------------------------------------------------------------
// Gathering: how a Domain claims the Pieces about it. Computed from
// frontmatter, never stored on the Piece.

/** What Gathering reads from a finished Piece. */
export interface PieceFacts {
  /** Tags on the Piece, frontmatter and inline, with or without `#`. */
  tags: string[];
  /** Basenames of the notes the Piece links in `about`. */
  about: string[];
}

/** What Gathering reads from a Domain. */
export interface DomainFacts {
  name: string;
  /** The `gathers:` list: tags, with or without `#`. */
  gathers: string[];
}

/** One tag in the form both sides are compared in: no `#`, lower case. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, '').toLowerCase();
}

/**
 * Pure: the names of the Domains that gather a Piece. A Domain gathers it
 * when their tags meet, or when the Piece names the Domain in `about`. A
 * Piece can belong to several Domains. Empty means the self gathers it.
 */
export function gatherers(piece: PieceFacts, domains: DomainFacts[]): string[] {
  const tags = new Set(piece.tags.map(normalizeTag).filter(Boolean));
  const about = new Set(piece.about.map((a) => a.trim().toLowerCase()));
  return domains
    .filter((d) => about.has(d.name.toLowerCase()) || d.gathers.some((g) => tags.has(normalizeTag(g))))
    .map((d) => d.name);
}

/** Tags of a note: frontmatter `tags` (string or list) and inline `#tag`s, as the cache holds them. */
function tagsOf(cache: CachedMetadata | null): string[] {
  const fm = cache?.frontmatter?.['tags'];
  const fromFrontmatter = Array.isArray(fm) ? fm.map(String) : typeof fm === 'string' ? fm.split(/[,\s]+/) : [];
  const inline = (cache?.tags ?? []).map((t) => t.tag);
  return [...fromFrontmatter, ...inline];
}

/** Basenames of the notes a note links in `about`. */
function aboutOf(app: App, file: TFile, cache: CachedMetadata | null): string[] {
  const out: string[] = [];
  for (const fl of cache?.frontmatterLinks ?? []) {
    if (fl.key !== 'about' && !fl.key.startsWith('about.')) continue;
    const ref = parseRef(fl.link);
    const dest = ref && resolveRef(app, ref, file.path);
    out.push(dest ? dest.file.basename : (ref?.path.split('/').pop() ?? fl.link));
  }
  return out;
}

/**
 * Every revisitable Piece, filed under the Well that gathers it: a Domain's
 * name, or `me` for the Pieces no Domain gathers. A Piece gathered by two
 * Domains appears under both.
 */
export function gatheredBy(app: App): Map<string, TFile[]> {
  const files = app.vault.getMarkdownFiles();
  const domains: DomainFacts[] = files
    .filter((f) => classify(f) === 'domain')
    .map((f) => {
      const g = app.metadataCache.getFileCache(f)?.frontmatter?.['gathers'];
      const gathers = Array.isArray(g) ? g.map(String) : typeof g === 'string' ? g.split(/[,\s]+/) : [];
      return { name: f.basename, gathers };
    });

  const out = new Map<string, TFile[]>();
  const file = (name: string, piece: TFile) => {
    const list = out.get(name);
    if (list) list.push(piece);
    else out.set(name, [piece]);
  };
  for (const piece of files) {
    if (!isRevisitable(app, piece)) continue;
    const cache = app.metadataCache.getFileCache(piece);
    const names = gatherers({ tags: tagsOf(cache), about: aboutOf(app, piece, cache) }, domains);
    if (names.length === 0) file(ME_BASENAME, piece);
    for (const name of names) file(name, piece);
  }
  return out;
}
