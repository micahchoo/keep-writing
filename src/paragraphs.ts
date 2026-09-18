// The paragraph jar: every paragraph the owner wrote that the draw can put in
// front of them. One rule — every block with an id, in a folder the owner
// named (settings.ts, `writingFolders`). Their daily notes are in that list by
// default, so their own answers come back to them; a folder of finished
// writing is the other thing most people add.
//
// The two shelves were `Pieces/` and `Sittings/`, by path, until 2026-09-17,
// and `Pieces` was a folder name compiled into the plugin. A note also had to
// carry a `status` to be reached, which for anybody but this vault's owner
// would have meant an empty jar and no way to find out why. Now: named the
// folder, in the jar. One note may opt out with `status: page`.
//
// A paragraph from this jar is handed to bonsai to compose the question (a
// Revisit), with one line of framing: when and where it was written.
//
// There was a third shelf until 2026-09-17 — the bodies of Domain and Learning
// notes, drawn id or not, given an id when accepted — and a filing of every
// paragraph under the Well it came from. Both are gone with the Well. Those
// notes are still reachable: the owner highlights a paragraph in one and asks
// about it, which now works in ANY note. What is lost is the automatic side,
// and after two weeks those bodies held zero words.
//
// Not every block with an id is a paragraph the owner wrote. The corpus
// carries furniture that the import gave an id to: Hugo shortcodes, figure
// captions, project-sheet fields, bibliography entries. Furniture is its own
// module (furniture.ts) with its own canon entry and three consumers; the jar
// is the one that takes the word floor with it.

import type { App, TFile } from 'obsidian';
import { headingAbove, readsAsParagraph } from './furniture';
import { blockTexts, refOf, resolveRef } from './refs';
import type { Ref } from './refs';
import { isSitting } from './target';

/** The register a paragraph counts as. */
const REVISIT_REGISTER = 'revisit';

/** `note` is any other note the owner writes in: only a Selection reaches one. */
export type Origin = 'piece' | 'sitting' | 'note';

export interface Paragraph {
  kind: 'paragraph';
  file: TFile;
  /** `Pieces/x#^p-004`; note-level (no blockId) while the paragraph has no id yet. */
  ref: Ref;
  /** `Pieces/x.md#^p-004` for answered-ness lookups; `Domains/x.md#L12` while there is no id. */
  key: string;
  register: typeof REVISIT_REGISTER;
  /** The paragraph, block id and list marker stripped. */
  text: string;
  origin: Origin;
  /** One line for bonsai: `in 2021, for Branch Magazine`; `in a Sitting on 2026-09-12`. */
  framing: string;
  /** Link text for the pane: the Piece's title, the Sitting's date, the note's name. */
  title: string;
  /** Meta parts after the title on the pane's framing line: date, publisher, `set down`. */
  meta: string[];
  /** First line of the paragraph, 0-based: what ensureBlockId needs when there is no id yet. */
  line: number;
  /** `published` or `set-down` for a Piece paragraph; absent for every other shelf. */
  status?: string;
}

/** Facts a Piece's frontmatter carries into the framing of its paragraphs. */
export interface PieceFraming {
  /** `YYYY-MM-DD` as written on the Piece; empty when absent. */
  pieceDate: string;
  /** `published` or `set-down`. */
  status: string;
  /** The Piece's title. Empty only when it has neither a title nor a basename. */
  title: string;
  /** `external_publisher` on the Piece, when it has one. */
  publisher?: string;
}

/**
 * Pure: one line of framing for a Piece paragraph, when and where it was
 * written: `in 2021, in "Koramangala", for Branch Magazine`; `in 2020, in
 * "Rivers", a draft they set down`.
 *
 * The title is what stops a Revisit reading as random. Measured 2026-09-15
 * against bonsai-27b over real corpus blocks: without it, a paragraph pulled
 * from the middle of an essay has no referent, and the model asks about the
 * words in front of it ("What specific geographical data was used to
 * georeference the PNG file?"). With it, the same block asks the owner
 * something only they can answer ("What specific historical detail did you
 * discover when the map aligned with the geographical data?").
 */
export function framingOf(p: PieceFraming): string {
  const year = /^\d{4}/.exec(p.pieceDate)?.[0];
  const when = year ? `in ${year}` : 'some time ago';
  const where = p.title ? `${when}, in "${p.title}"` : when;
  if (p.status === 'set-down') return `${where}, a draft they set down`;
  return p.publisher ? `${where}, for ${p.publisher}` : where;
}

/** Pure: framing for a paragraph of any other note the owner writes in. */
export function noteFraming(name: string): string {
  return `in their note on ${name}`;
}

/**
 * Pure: a Sitting's day and the owner's own name for it, read off its
 * basename. `Sittings/2026-09-15.md` is the template's name; the owner
 * renames a Sitting to what the day was about, keeping the date or dropping
 * it ("2026-09-12-prattler", "Suffering a Repitition").
 */
export function sittingName(basename: string): { date: string; called: string } {
  const [, date = '', called = ''] = /^(\d{4}-\d{2}-\d{2})[-\s]*(.*)$/.exec(basename) ?? [];
  if (date) return { date, called: called.trim() };
  return { date: '', called: basename.trim() };
}

/**
 * Pure: framing for a Sitting block, from the Sitting's basename.
 *
 * The name the owner gave the day is context worth having, and saying it as a
 * name rather than as a date is what makes it usable. Before 2026-09-16 this
 * took a date and fell back to the basename, so a renamed Sitting framed as
 * "in a Sitting on Suffering a Repitition" — four of the seven real Sittings.
 * Measured that day: said as a name instead, the same block produced the
 * sharper question, reaching for the owner's own coined term ("what does it
 * feel like when you are the weather vane versus when you are the one who
 * must decide which way to face?").
 */
export function sittingFraming(basename: string): string {
  const { date, called } = sittingName(basename);
  if (date && called) return `in a Sitting on ${date} they called "${called}"`;
  if (date) return `in a Sitting on ${date}`;
  return `in a Sitting they called "${called}"`;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * What a note lends to every paragraph in it: the Well the draw files it
 * under, the line of framing bonsai reads, the name the pane shows. One
 * source for the three jar shelves and for a paragraph the owner picks by
 * hand (selection.ts).
 */
export interface ParagraphFacts {
  origin: Origin;
  framing: string;
  title: string;
  meta: string[];
  /** `published` or `set-down` for a Piece; empty for every other shelf. */
  status?: string;
}

function pieceFacts(app: App, piece: TFile): ParagraphFacts {
  const fm = app.metadataCache.getFileCache(piece)?.frontmatter ?? {};
  const pieceDate = str(fm['date']);
  const status = str(fm['status']);
  const publisher = str(fm['external_publisher']);
  const title = str(fm['title']) || piece.basename;
  const framing: PieceFraming = publisher ? { pieceDate, status, title, publisher } : { pieceDate, status, title };
  return {
    origin: 'piece',
    // An open Piece has no status, so it was not written "some time ago":
    // it is the thing being written. The jar never sees one; a selection can.
    framing: status ? framingOf(framing) : `in "${title}", the Piece they are writing`,
    title,
    meta: [pieceDate, publisher || (status === 'set-down' ? 'set down' : '')].filter(Boolean),
    status,
  };
}

export function sittingFacts(sitting: TFile): ParagraphFacts {
  const { date, called } = sittingName(sitting.basename);
  return {
    origin: 'sitting',
    framing: sittingFraming(sitting.basename),
    // The pane shows what the owner named the day, and keeps the date beside it.
    title: called || `Sitting ${date}`,
    meta: called && date ? [date] : [],
  };
}

export function noteFacts(note: TFile): ParagraphFacts {
  return {
    origin: 'note',
    framing: noteFraming(note.basename),
    title: note.basename,
    meta: ['their note'],
  };
}

/**
 * `status: page` marks site furniture — a resume, a section index. Finished
 * and linkable, and never put in front of the owner. It is the one way a note
 * inside a writing folder stays out of the jar.
 */
const NOT_DRAWN = 'page';

/** Is this note one the draw may reach at all? */
export function isDrawn(app: App, file: TFile): boolean {
  return app.metadataCache.getFileCache(file)?.frontmatter?.['status'] !== NOT_DRAWN;
}

/** Is this note under one of the folders the owner named? */
export function inFolders(file: TFile, folders: string[]): boolean {
  return folders.some((f) => f && file.path.startsWith(f + '/'));
}

/**
 * The facts of whatever note this is. Never null: the owner may point at a
 * paragraph in ANY note and be asked about it.
 *
 * It read the note's PATH until 2026-09-17 — a Piece was a Piece because it
 * sat in `Pieces/`. It reads the frontmatter now: a note that says when it was
 * written, that it is finished, or what it is called, can be framed with a
 * year and a title — which is what a composed question needs, and what the
 * folder name never told anyone. Everything else is just a note.
 *
 * It returned null for anything that was not a Sitting, a Piece, a Domain or a
 * Learning note until 2026-09-17, and a Selection refused with "Ask about the
 * selection works in a Sitting, a Piece, a Domain or a Learning note." That
 * was a fence around the owner's own vault, and nothing behind it needed one.
 */
export function fileFacts(app: App, file: TFile, sittingsFolder: string): ParagraphFacts {
  if (isSitting(file, sittingsFolder)) return sittingFacts(file);
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const declared = str(fm['date']) || str(fm['status']) || str(fm['title']);
  return declared ? pieceFacts(app, file) : noteFacts(file);
}

/** One unit of a note the draw or a Selection may take: a block, with or without an id. */
export interface ParagraphBlock {
  /** Absent while the paragraph has no block id: a Well body, or a fresh Selection. */
  id?: string;
  /** First line of the paragraph, 0-based. */
  line: number;
  /** The paragraph, block id and list marker already stripped. */
  text: string;
}

/**
 * One paragraph of the jar: what the note lends every paragraph in it
 * (`facts`) and what this block is.
 *
 * The key is the one thing every path here must agree on, because
 * answered-ness is keyed by it (bank.ts#AnsweredIndex): a block with an id is
 * addressed by the id, one without is addressed by its line and gets a real
 * id when the Ask is accepted (blocks.ts#ensureBlockId). Before 2026-09-17
 * this literal was written in four places — the two block shelves, the Well
 * body shelf, and a Selection in another module — and two of them spelled the
 * key without the branch.
 */
export function paragraphOf(file: TFile, facts: ParagraphFacts, block: ParagraphBlock): Paragraph {
  return {
    kind: 'paragraph',
    file,
    ref: refOf(file, block.id),
    key: block.id ? `${file.path}#^${block.id}` : `${file.path}#L${block.line}`,
    register: REVISIT_REGISTER,
    text: block.text,
    ...facts,
    line: block.line,
  };
}

/**
 * The paragraph one ref points at, with the facts of whatever note holds it.
 * Null when the ref names no block, does not resolve, or points at a block
 * that is gone — a ref written days ago into a property outlives the text it
 * was written about.
 *
 * Nothing here asks whether the paragraph is drawable. That is the jar's
 * question, and this is the way IN to one named paragraph.
 */
export async function paragraphAt(app: App, ref: Ref, sittingsFolder: string): Promise<Paragraph | null> {
  const r = resolveRef(app, ref);
  if (!r?.blockId) return null;
  const block = (await blockTexts(app, r.file)).find((b) => b.id === r.blockId);
  return block ? paragraphOf(r.file, fileFacts(app, r.file, sittingsFolder), block) : null;
}

/**
 * The paragraphs of a note whose blocks already carry ids: a finished Piece,
 * or a Sitting. The two shelves differ only in the facts their note lends.
 */
async function blockParagraphs(app: App, file: TFile, facts: ParagraphFacts): Promise<Paragraph[]> {
  return (await blockTexts(app, file)).map((b) => paragraphOf(file, facts, b));
}

/**
 * Pure: one paragraph per distinct text. The corpus keeps every telling of a
 * Piece (CONTEXT.md, "Piece"), so the same words reach the jar under two
 * refs: 186 of 722 Piece paragraphs on 2026-09-16, 86 of them from a single
 * pair of tellings. To the draw two tellings are one paragraph. Left alone
 * they carry double weight, and because answered-ness is keyed by ref
 * (bank.ts#AnsweredIndex), answering one telling never retires the other, so
 * the owner can be asked about the same words twice.
 *
 * The telling kept is the finished one (published over set-down), then the
 * shortest path, so the choice cannot move between runs.
 */
export function oneTellingEach(paragraphs: Paragraph[]): Paragraph[] {
  const best = new Map<string, Paragraph>();
  const order: string[] = [];
  const rank = (p: Paragraph) => (p.status === 'published' ? 0 : 1);
  for (const p of paragraphs) {
    const seen = best.get(p.text);
    if (!seen) {
      best.set(p.text, p);
      order.push(p.text);
      continue;
    }
    const winner =
      rank(p) < rank(seen) || (rank(p) === rank(seen) && p.file.path < seen.file.path) ? p : seen;
    best.set(p.text, winner);
  }
  return order.map((t) => best.get(t) as Paragraph);
}

/**
 * The whole paragraph jar, before answered-ness: every id'd block of every
 * note in the folders the owner named. Furniture is strained out here, and so
 * is a second telling of the same words, in the one place every paragraph
 * passes through, so no caller can forget either.
 */
export async function paragraphJar(
  app: App,
  sittingsFolder: string,
  writingFolders: string[],
): Promise<Paragraph[]> {
  const jar: Paragraph[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (!inFolders(file, writingFolders) || !isDrawn(app, file)) continue;
    jar.push(...(await blockParagraphs(app, file, fileFacts(app, file, sittingsFolder))));
  }
  const prose = jar.filter((p) =>
    readsAsParagraph(p.text, headingAbove(app.metadataCache.getFileCache(p.file), p.line)),
  );
  return oneTellingEach(prose);
}
