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
//
// There was a `Pieces/` folder name in here until 2026-09-17, and `classify`,
// `isFinishedPiece` and `isRevisitable` read it: a note was the owner's
// writing because of where it sat. Nobody else's vault has that folder. The
// owner NAMES the folders now (settings.ts, `writingFolders`), and what a note
// lends its paragraphs is read off its frontmatter rather than its path
// (paragraphs.ts#fileFacts).

import type { App, TFile } from 'obsidian';
import { refNamed, resolveRef } from './refs';

/** The note a bookmark lands on when the day has no Target. */
export const ME_BASENAME = 'me';

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
  const ref = refNamed(app.metadataCache.getFileCache(sitting), 'about');
  return ref ? resolveRef(app, ref, sitting.path)?.file ?? null : null;
}

export function isSitting(file: TFile | null, sittingsFolder: string): file is TFile {
  return !!file && file.extension === 'md' && file.path.startsWith(sittingsFolder + '/');
}
