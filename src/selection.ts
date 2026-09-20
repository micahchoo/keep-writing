// "Ask about the selection": the owner points at their own words and the
// interview takes them as the source.
//
// The paragraph jar only reaches blocks that already carry an id, in a Sitting
// or a finished Piece. This is the hand-worked way in, and it reaches further
// than the jar ever did: any run of text, in ANY note, id or not. The block
// gets its id when the Ask is accepted.
//
// It refused everything outside four folders until 2026-09-17 — "Ask about the
// selection works in a Sitting, a Piece, a Domain or a Learning note" — which
// was a fence around the owner's own vault. Nothing behind it needed one, and
// with Domain and Learning notes no longer known to the code, the fence would
// have shut the owner out of the two folders the plugin had just told them to
// write in.
//
// The jar's furniture test (furniture.ts#readsAsParagraph) does not run
// here. Its word floor is the draw's standard, for choosing among a thousand
// blocks unattended; what the owner selects by hand, they meant, and a short
// line they point at is exactly what a Revisit wants. Only one thing is
// refused: a selection with no prose in it at all, which gives the model
// nothing to ask about and makes it invent (measured 2026-09-15: handed a
// bare `{{< figure >}}`, bonsai asked which part of the owner's daily routine
// felt like a basemap).

import type { App, TFile } from 'obsidian';
import { paragraphAt } from './blocks';
import { proseOf } from './furniture';
import { fileFacts, paragraphOf } from './paragraphs';
import { Refused } from './refusal';
import type { Paragraph } from './paragraphs';
import { stripBlockDecoration } from './refs';

/**
 * Longest selection handed to bonsai. Past about this much the composed
 * question turns into a summary of the passage instead of a question about
 * it, and the model has more than one thing to ask about.
 */
export const MAX_SELECTION = 1500;

/** Why a selection cannot become a source. The message is for the owner. */
export class NotSelectable extends Refused {}

/**
 * The selected words as a paragraph source. `text` is the selection; the ref
 * and the line are the whole block that holds it, because an Ask cites a
 * block, and a block is the smallest thing Obsidian can link and embed.
 *
 * Throws NotSelectable with a message to show.
 */
export function selectionParagraph(
  app: App,
  file: TFile,
  selected: string,
  line: number,
  sittingsFolder: string,
  document?: string,
): Paragraph {
  const text = stripBlockDecoration(selected);
  if (!text) throw new NotSelectable('Select the words to ask about first.');
  if (!proseOf(text)) throw new NotSelectable('That selection is a link, an image or markup. Select words to ask about.');
  if (text.length > MAX_SELECTION) {
    throw new NotSelectable(`That selection is ${text.length} characters. Select fewer than ${MAX_SELECTION}.`);
  }
  const facts = fileFacts(app, file, sittingsFolder);
  const block = paragraphAt(app.metadataCache.getFileCache(file), line);
  if (!block) throw new NotSelectable('Select inside a paragraph or a list item.');
  // The text is the SELECTION; the ref, the key and the line are the whole
  // block that holds it. Everything else a paragraph carries is the note's.
  const paragraph = paragraphOf(file, facts, { id: block.id, line: block.start, text });
  const original = document?.split('\n').slice(block.start, block.end + 1).join('\n');
  if (original !== undefined && !original.includes(selected)) {
    throw new NotSelectable('The paragraph changed. Select it again.');
  }
  paragraph.selectionSnapshot = { selected: selected.trim(), ...(original !== undefined ? { block: original } : {}) };
  return paragraph;
}
