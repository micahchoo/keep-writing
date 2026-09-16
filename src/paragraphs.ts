// The paragraph jar: every paragraph the owner wrote that the draw can put
// in front of them, each filed under its Well(s). Three shelves:
//
// - finished Pieces (published, set-down): their blocks with ids, filed under
//   the Domain(s) that gather the Piece, or the self;
// - Sittings: their blocks with ids (answers are paragraphs too; an Ask
//   callout has no id, so it is never here), filed under the self;
// - the bodies of Domain and Learning notes: every paragraph, id or not,
//   filed under that note. A paragraph without an id is drawable; it is
//   given one (blocks.ts#ensureBlockId) only when drawn and accepted, so the
//   Ask can cite it.
//
// A paragraph from this jar is handed to bonsai to compose the question (a
// Revisit), with one line of framing: when and where it was written.

import type { App, CachedMetadata, TFile } from 'obsidian';
import { blockText, refOf, stripBlockDecoration } from './refs';
import type { Ref } from './refs';
import { ME_BASENAME, classify, gatheredBy, isSitting } from './target';

/** The register a paragraph counts as. */
export const REVISIT_REGISTER = 'revisit';

export type Origin = 'piece' | 'sitting' | 'domain' | 'learning';

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
  /** Names of the Wells it belongs to; a Piece gathered by two Domains is filed under both. */
  wells: string[];
  /** One line for bonsai: `in 2021, for Branch Magazine`; `in a Sitting on 2026-09-12`. */
  framing: string;
  /** Link text for the pane: the Piece's title, the Sitting's date, the note's name. */
  title: string;
  /** Meta parts after the title on the pane's framing line: date, publisher, `set down`. */
  meta: string[];
  /** First line of the paragraph, 0-based: what ensureBlockId needs when there is no id yet. */
  line: number;
}

/** Facts a Piece's frontmatter carries into the framing of its paragraphs. */
export interface PieceFraming {
  /** `YYYY-MM-DD` as written on the Piece; empty when absent. */
  pieceDate: string;
  /** `published` or `set-down`. */
  status: string;
  /** `external_publisher` on the Piece, when it has one. */
  publisher?: string;
}

/**
 * Pure: one line of framing for a Piece paragraph, when and where it was
 * written: `in 2021, for Branch Magazine`; `in 2020, in a draft they set
 * down`.
 */
export function framingOf(p: PieceFraming): string {
  const year = /^\d{4}/.exec(p.pieceDate)?.[0];
  const when = year ? `in ${year}` : 'some time ago';
  if (p.status === 'set-down') return `${when}, in a draft they set down`;
  return p.publisher ? `${when}, for ${p.publisher}` : when;
}

/** Pure: framing for a paragraph of a Domain or Learning note's body. */
export function noteFraming(origin: 'domain' | 'learning', name: string): string {
  return origin === 'domain' ? `in their note on ${name}` : `in what they wrote about wanting to learn ${name}`;
}

/** Pure: framing for a Sitting block. `date` is the day, or the Sitting's name when it has no date. */
export function sittingFraming(date: string): string {
  return `in a Sitting on ${date}`;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Blocks of a note that carry ids, in file order, as text. */
async function idBlocks(app: App, file: TFile): Promise<{ id: string; line: number; text: string }[]> {
  const blocks = app.metadataCache.getFileCache(file)?.blocks ?? {};
  const ids = Object.keys(blocks).sort((a, b) => blocks[a]!.position.start.line - blocks[b]!.position.start.line);
  const out: { id: string; line: number; text: string }[] = [];
  for (const id of ids) {
    const text = await blockText(app, file, id);
    if (text) out.push({ id, line: blocks[id]!.position.start.line, text });
  }
  return out;
}

/**
 * What a note lends to every paragraph in it: the Well the draw files it
 * under, the line of framing bonsai reads, the name the pane shows. One
 * source for the three jar shelves and for a paragraph the owner picks by
 * hand (selection.ts).
 */
export interface ParagraphFacts {
  origin: Origin;
  wells: string[];
  framing: string;
  title: string;
  meta: string[];
}

export function pieceFacts(app: App, piece: TFile, wells: string[]): ParagraphFacts {
  const fm = app.metadataCache.getFileCache(piece)?.frontmatter ?? {};
  const pieceDate = str(fm['date']);
  const status = str(fm['status']);
  const publisher = str(fm['external_publisher']);
  const framing: PieceFraming = publisher ? { pieceDate, status, publisher } : { pieceDate, status };
  return {
    origin: 'piece',
    wells,
    // An open Piece has no status, so it was not written "some time ago":
    // it is the thing being written. The jar never sees one; a selection can.
    framing: status ? framingOf(framing) : 'in the Piece they are writing',
    title: str(fm['title']) || piece.basename,
    meta: [pieceDate, publisher || (status === 'set-down' ? 'set down' : '')].filter(Boolean),
  };
}

export function sittingFacts(sitting: TFile): ParagraphFacts {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(sitting.basename)?.[0] ?? sitting.basename;
  return {
    origin: 'sitting',
    wells: [ME_BASENAME],
    framing: sittingFraming(date),
    title: `Sitting ${date}`,
    meta: [],
  };
}

export function noteFacts(note: TFile, origin: 'domain' | 'learning'): ParagraphFacts {
  return {
    origin,
    wells: [note.basename],
    framing: noteFraming(origin, note.basename),
    title: note.basename,
    meta: [origin === 'domain' ? 'their note' : 'wanting to learn'],
  };
}

/** The Wells that gather this Piece; the self when no Domain does. */
export function wellsOfPiece(app: App, piece: TFile): string[] {
  const names: string[] = [];
  for (const [well, pieces] of gatheredBy(app)) {
    if (pieces.some((p) => p.path === piece.path)) names.push(well);
  }
  return names.length > 0 ? names : [ME_BASENAME];
}

/**
 * The facts of whatever kind of note this is. Null when the note is not one
 * the owner writes paragraphs in, so nothing can be drawn or picked from it.
 */
export function fileFacts(app: App, file: TFile, sittingsFolder: string): ParagraphFacts | null {
  if (isSitting(file, sittingsFolder)) return sittingFacts(file);
  const kind = classify(file);
  if (kind === 'piece') return pieceFacts(app, file, wellsOfPiece(app, file));
  if (kind === 'domain' || kind === 'learning') return noteFacts(file, kind);
  return null;
}

/** The paragraphs of one finished Piece: its blocks with ids. */
export async function pieceParagraphs(app: App, piece: TFile, wells: string[]): Promise<Paragraph[]> {
  const facts = pieceFacts(app, piece, wells);
  return (await idBlocks(app, piece)).map((b) => ({
    kind: 'paragraph',
    file: piece,
    ref: refOf(piece, b.id),
    key: `${piece.path}#^${b.id}`,
    register: REVISIT_REGISTER,
    text: b.text,
    ...facts,
    line: b.line,
  }));
}

/** The paragraphs of one Sitting: its blocks with ids, filed under the self. */
export async function sittingParagraphs(app: App, sitting: TFile): Promise<Paragraph[]> {
  const facts = sittingFacts(sitting);
  return (await idBlocks(app, sitting)).map((b) => ({
    kind: 'paragraph',
    file: sitting,
    ref: refOf(sitting, b.id),
    key: `${sitting.path}#^${b.id}`,
    register: REVISIT_REGISTER,
    text: b.text,
    ...facts,
    line: b.line,
  }));
}

/** One unit of a note body that can carry an inline block id: a paragraph, or one list item. */
interface BodyUnit {
  start: number;
  end: number;
  id?: string;
}

/**
 * Pure: the units of a note body the draw may pick: paragraph sections, the
 * items of list sections, and blockquotes that already carry an id (the
 * plugin cannot give a blockquote an inline id, so one without is not
 * drawable). Headings, code, tables and the frontmatter are not the owner's
 * paragraphs.
 */
export function bodyUnits(cache: CachedMetadata | null): BodyUnit[] {
  const units: BodyUnit[] = [];
  for (const s of cache?.sections ?? []) {
    const { start, end } = s.position;
    if (s.type === 'paragraph' || (s.type === 'blockquote' && s.id)) {
      units.push(s.id ? { start: start.line, end: end.line, id: s.id } : { start: start.line, end: end.line });
    } else if (s.type === 'list') {
      for (const item of cache?.listItems ?? []) {
        const p = item.position;
        if (p.start.line < start.line || p.end.line > end.line) continue;
        units.push(item.id ? { start: p.start.line, end: p.end.line, id: item.id } : { start: p.start.line, end: p.end.line });
      }
    }
  }
  return units;
}

/** The paragraphs of a Domain or Learning note's body, id or not, filed under that note. */
export async function bodyParagraphs(app: App, note: TFile, origin: 'domain' | 'learning'): Promise<Paragraph[]> {
  const units = bodyUnits(app.metadataCache.getFileCache(note));
  if (units.length === 0) return [];
  const lines = (await app.vault.cachedRead(note)).split('\n');
  const facts = noteFacts(note, origin);
  const out: Paragraph[] = [];
  for (const u of units) {
    const text = stripBlockDecoration(lines.slice(u.start, u.end + 1).join('\n'));
    if (!text) continue;
    out.push({
      kind: 'paragraph',
      file: note,
      ref: refOf(note, u.id),
      key: u.id ? `${note.path}#^${u.id}` : `${note.path}#L${u.start}`,
      register: REVISIT_REGISTER,
      text,
      ...facts,
      line: u.start,
    });
  }
  return out;
}

/**
 * The whole paragraph jar, before answered-ness: every shelf, every
 * paragraph, each filed under its Well(s).
 */
export async function paragraphJar(app: App, sittingsFolder: string): Promise<Paragraph[]> {
  const jar: Paragraph[] = [];
  const wellsOf = new Map<string, string[]>();
  for (const [well, pieces] of gatheredBy(app)) {
    for (const piece of pieces) wellsOf.set(piece.path, [...(wellsOf.get(piece.path) ?? []), well]);
  }
  for (const file of app.vault.getMarkdownFiles()) {
    const wells = wellsOf.get(file.path);
    if (wells) jar.push(...(await pieceParagraphs(app, file, wells)));
    else if (isSitting(file, sittingsFolder)) jar.push(...(await sittingParagraphs(app, file)));
    else {
      const kind = classify(file);
      if (kind === 'domain' || kind === 'learning') jar.push(...(await bodyParagraphs(app, file, kind)));
    }
  }
  return jar;
}
