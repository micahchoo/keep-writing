// What kind of note this is, and the Target.
//
// There were Wells here until 2026-09-17: the self, each Domain, each Learning
// note, and a Gathering that claimed Pieces for a Domain by tag. A Well did
// two jobs — it chose which Lens composed the question, and it spread the
// draw. The second job was the defect: the draw picked a Well uniformly and
// then a paragraph inside it, so a Domain holding 1.5% of the writing took
// 12.5% of the picks, while the self held 36.5% and took the same 12.5%. That
// is the register-weighting defect of 2026-09-15 one level up. The first job
// went away on its own when the Lens became a property of the PATH — picked at
// random, or pointed at by hand — rather than of the folder a note sits in.
//
// `gathers:` stays in the Domain notes as ordinary Obsidian tags. The tag pane
// reads them, search reads them, and no code does.

import type { App, TFile } from 'obsidian';
import { linksNamed, parseRef, resolveRef } from './refs';

/** Where the owner's finished writing lives. Becomes a setting when the plugin ships. */
const PIECES_FOLDER = 'Pieces';
/** The note a bookmark lands on when the day has no Target. */
export const ME_BASENAME = 'me';

export type NoteKind = 'me' | 'piece';

export function classify(file: TFile | null): NoteKind | null {
  if (!file) return null;
  if (file.basename === ME_BASENAME && !file.path.includes('/')) return 'me';
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
 * A Piece whose paragraphs the draw may reach: published or set-down.
 * `status: page` marks site furniture (a resume, a section index): finished
 * and linkable, but never put in front of the owner.
 */
export function isRevisitable(app: App, file: TFile): boolean {
  if (!isFinishedPiece(app, file)) return false;
  return app.metadataCache.getFileCache(file)?.frontmatter?.['status'] !== 'page';
}

/**
 * `about` on a Sitting: the one note the day is spent on. Its paragraphs are
 * then the whole paragraph jar, and the Bank jar is empty.
 *
 * It named a Well or a finished Piece until 2026-09-17, and a Well stood for a
 * whole group of notes. It names ONE note now, which is the same thing said
 * without the grouping: point it at a Piece to work over that Piece, or at any
 * note you have been writing in.
 */
export function readTarget(app: App, sitting: TFile): TFile | null {
  const cache = app.metadataCache.getFileCache(sitting);
  const fl = linksNamed(cache, 'about')[0];
  const raw = fl?.original ?? stringProp(cache?.frontmatter?.['about']);
  if (!raw) return null;
  const ref = parseRef(fl?.link ?? raw);
  return ref ? resolveRef(app, ref, sitting.path)?.file ?? null : null;
}

function stringProp(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

export function isSitting(file: TFile | null, sittingsFolder: string): file is TFile {
  return !!file && file.extension === 'md' && file.path.startsWith(sittingsFolder + '/');
}
