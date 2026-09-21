// Furniture: what carries a block id but is not a paragraph the owner wrote.
// See CONTEXT.md, "Furniture".
//
// The corpus import gives every block an id, so `Pieces/` holds Hugo
// shortcodes, figure captions, project-sheet fields and bibliography entries
// beside the writing. These are the tests that tell one from the other.
//
// Two paths take them differently, and the difference is the word floor:
//
// - the DRAW (paragraphs.ts) takes `readsAsParagraph`: furniture AND the floor;
// - a SELECTION (selection.ts) takes `proseOf` alone, refusing only a run of
//   text with no prose in it at all, because what the owner points at they meant.
//
// A third, the Proposal pool, took the furniture test without the floor until
// the pool went on 2026-09-17; `isFurniture` outlived it with no caller until
// 2026-09-21.
//
// Nothing here reads the vault. `headingAbove` takes a cache the caller already has.

import type { CachedMetadata } from 'obsidian';

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
 * Pure: may the DRAW put this block in front of the owner? Not furniture, and
 * over the word floor.
 *
 * The floor belongs to the draw alone — it is choosing unattended among a
 * thousand blocks, and pays for that with some real short lines. A Selection
 * takes the prose test without it, because what the owner points at they meant.
 *
 * Counted over `Pieces/` on 2026-09-15, each rule catches a species the
 * others miss: 126 blocks only the floor rejects, 33 only the caption or
 * field label, 39 only the bibliography heading.
 */
export function readsAsParagraph(text: string, heading = ''): boolean {
  if (FURNITURE_HEADING.test(heading)) return false;
  const prose = proseOf(text);
  if (!prose || FIELD_LABEL.test(prose)) return false;
  return prose.split(' ').length >= MIN_PROSE_WORDS;
}

/** The nearest heading at or above `line`, lower-cased; empty when there is none. */
export function headingAbove(cache: CachedMetadata | null, line: number): string {
  const headings = cache?.headings ?? [];
  let lo = 0;
  let hi = headings.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (headings[mid].position.start.line <= line) lo = mid + 1;
    else hi = mid;
  }
  return lo ? headings[lo - 1].heading.toLowerCase() : '';
}
