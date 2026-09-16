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
//
// Not every block with an id is a paragraph the owner wrote. The corpus
// carries furniture that the import gave an id to: Hugo shortcodes, figure
// captions, project-sheet fields, bibliography entries. `readsAsParagraph`
// keeps those out of the jar. See CONTEXT.md, "Furniture".

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

/** Pure: framing for a paragraph of a Domain or Learning note's body. */
export function noteFraming(origin: 'domain' | 'learning', name: string): string {
  return origin === 'domain' ? `in their note on ${name}` : `in what they wrote about wanting to learn ${name}`;
}

/**
 * Pure: a Sitting's day and the owner's own name for it, read off its
 * basename. `Sittings/2026-09-15.md` is the template's name; the owner
 * renames a Sitting to what the day was about, keeping the date or dropping
 * it ("2026-09-12-prattler", "Suffering a Repitition").
 */
export function sittingName(basename: string): { date: string; called: string } {
  const m = /^(\d{4}-\d{2}-\d{2})[-\s]*(.*)$/.exec(basename);
  if (m) return { date: m[1] as string, called: (m[2] ?? '').trim() };
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

// ---------------------------------------------------------------------------
// Furniture: what carries a block id but is not a paragraph the owner wrote.

/**
 * Fewest words of prose a block needs before the draw will put it in front of
 * the owner. Measured 2026-09-15 over the 989 drawable blocks in `Pieces/`:
 * under twelve, the corpus is mostly figure captions, project-sheet fields
 * and navigation. The floor costs some real short lines ("Who gets to hold
 * memory, and on whose terms?"), which is why it does not apply to a
 * Selection: what the owner picks by hand, they meant.
 */
export const MIN_PROSE_WORDS = 12;

/**
 * Labels the corpus puts in front of a colon when the block is a caption or a
 * project-sheet field, not prose. Read from `Pieces/` on 2026-09-15; closed,
 * because it is one person's corpus. Extend it by finding one.
 */
const FIELD_LABEL =
  /^(fig(?:ure)?\s*\d+|my role|my contribution|duration|project duration|project information|people involved|credits?)\s*:/i;

/** Headings whose blocks are apparatus: the owner assembled them, did not write them. */
const FURNITURE_HEADING =
  /bibliograph|reference|citation|works cited|footnote|acknowledg|appendix|further reading/i;

/**
 * Pure: the prose left in a block once the markup is out — what a question
 * could be about. An image is dropped whole (its alt text is written for a
 * machine); a link keeps its words and loses its URL.
 *
 * This is a measuring instrument, not a payload. It is never written to a
 * file, and it is never what bonsai reads: measured 2026-09-15 against
 * bonsai-27b, handing it stripped prose instead of raw changed no composed
 * question. Only `readsAsParagraph` calls it.
 */
export function proseOf(text: string): string {
  return text
    .replace(/\{\{[<%][\s\S]*?[>%]\}\}/g, '') // Hugo shortcode
    .replace(/\{:[^}]*\}/g, '') // kramdown attribute list
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // image
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // link: keep the words
    .replace(/<[^>]+>/g, '') // html tag
    .replace(/`[^`]*`/g, '') // inline code
    .replace(/https?:\/\/\S+/g, '') // bare url
    .replace(/[*_#>|~]+/g, ' ') // emphasis, heading, quote, table, strike
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pure: is this block Furniture — something carrying a block id that the
 * owner did not write as prose? `heading` is the nearest heading above it,
 * empty when there is none. Three species: nothing but markup, a caption or
 * field label, and apparatus sitting under a bibliography.
 *
 * This is the test that holds wherever the owner's own words are wanted. It
 * carries no length rule, because length is not what makes something
 * furniture: "Who gets to hold memory, and on whose terms?" is nine words and
 * is entirely the owner's.
 */
export function isFurniture(text: string, heading = ''): boolean {
  if (FURNITURE_HEADING.test(heading)) return true;
  const prose = proseOf(text);
  if (!prose) return true;
  return FIELD_LABEL.test(prose);
}

/**
 * Pure: may the DRAW put this block in front of the owner? Not furniture, and
 * over the word floor.
 *
 * The floor belongs to the draw alone — it is choosing unattended among a
 * thousand blocks, and pays for that with some real short lines. The other
 * two paths take the furniture test without it: a Selection, because what the
 * owner points at they meant, and the Proposal pool (pool.ts), because a
 * short answer can still be the thing a later answer echoes.
 *
 * Counted over `Pieces/` on 2026-09-15, each rule catches a species the
 * others miss: 126 blocks only the floor rejects, 33 only the caption or
 * field label, 39 only the bibliography heading.
 */
export function readsAsParagraph(text: string, heading = ''): boolean {
  if (isFurniture(text, heading)) return false;
  return proseOf(text).split(' ').filter(Boolean).length >= MIN_PROSE_WORDS;
}

/** The nearest heading at or above `line`, lower-cased; empty when there is none. */
export function headingAbove(cache: CachedMetadata | null, line: number): string {
  let found = '';
  for (const h of cache?.headings ?? []) {
    if (h.position.start.line > line) break;
    found = h.heading;
  }
  return found.toLowerCase();
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
  /** `published` or `set-down` for a Piece; empty for every other shelf. */
  status?: string;
}

export function pieceFacts(app: App, piece: TFile, wells: string[]): ParagraphFacts {
  const fm = app.metadataCache.getFileCache(piece)?.frontmatter ?? {};
  const pieceDate = str(fm['date']);
  const status = str(fm['status']);
  const publisher = str(fm['external_publisher']);
  const title = str(fm['title']) || piece.basename;
  const framing: PieceFraming = publisher ? { pieceDate, status, title, publisher } : { pieceDate, status, title };
  return {
    origin: 'piece',
    wells,
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
    wells: [ME_BASENAME],
    framing: sittingFraming(sitting.basename),
    // The pane shows what the owner named the day, and keeps the date beside it.
    title: called || `Sitting ${date}`,
    meta: called && date ? [date] : [],
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
 * Pure: one paragraph per distinct text. The corpus keeps every telling of a
 * Piece (CONTEXT.md, "Piece"), so the same words reach the jar under two
 * refs: 186 of 722 Piece paragraphs on 2026-09-16, 86 of them from a single
 * pair of tellings. To the draw two tellings are one paragraph. Left alone
 * they carry double weight, and because answered-ness is keyed by ref
 * (bank.ts#AnsweredIndex), answering one telling never retires the other, so
 * the owner can be asked about the same words twice.
 *
 * The telling kept is the finished one (published over set-down), then the
 * shortest path, so the choice cannot move between runs. Every telling's
 * Wells are merged onto it: dropping a telling must not make a Well silent.
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
    const wells = [...new Set([...seen.wells, ...p.wells])];
    const winner =
      rank(p) < rank(seen) || (rank(p) === rank(seen) && p.file.path < seen.file.path) ? p : seen;
    best.set(p.text, { ...winner, wells });
  }
  return order.map((t) => best.get(t) as Paragraph);
}

/**
 * The whole paragraph jar, before answered-ness: every shelf, every
 * paragraph, each filed under its Well(s). Furniture is strained out here,
 * and so is a second telling of the same words, in the one place all three
 * shelves pass through, so no caller can forget either.
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
  const prose = jar.filter((p) =>
    readsAsParagraph(p.text, headingAbove(app.metadataCache.getFileCache(p.file), p.line)),
  );
  return oneTellingEach(prose);
}
