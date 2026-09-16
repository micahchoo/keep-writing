// "Ask about the selection": the owner points at their own words and the
// interview takes them as the source.
//
// The paragraph jar can only reach blocks that already carry an id, so most
// of what the owner writes in a Sitting is out of its reach (only the first
// paragraph of an answer is given an id). This is the hand-worked way in: any
// run of text, in any note the owner writes paragraphs in, id or not. The
// block gets its id when the Ask is accepted, which is the same moment the
// jar's own id-less paragraphs get theirs.

import type { App, TFile } from 'obsidian';
import { paragraphAt } from './blocks';
import { REVISIT_REGISTER, fileFacts } from './paragraphs';
import type { Paragraph } from './paragraphs';
import { refOf, stripBlockDecoration } from './refs';

/**
 * Longest selection handed to bonsai. Past about this much the composed
 * question turns into a summary of the passage instead of a question about
 * it, and the model has more than one thing to ask about.
 */
export const MAX_SELECTION = 1500;

/** Why a selection cannot become a source. The message is for the owner. */
export class NotSelectable extends Error {}

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
): Paragraph {
  const text = stripBlockDecoration(selected);
  if (!text) throw new NotSelectable('Select the words to ask about first.');
  if (text.length > MAX_SELECTION) {
    throw new NotSelectable(`That selection is ${text.length} characters. Select fewer than ${MAX_SELECTION}.`);
  }
  const facts = fileFacts(app, file, sittingsFolder);
  if (!facts) {
    throw new NotSelectable('Ask about the selection works in a Sitting, a Piece, a Domain or a Learning note.');
  }
  const block = paragraphAt(app.metadataCache.getFileCache(file), line);
  if (!block) throw new NotSelectable('Select inside a paragraph or a list item.');
  return {
    kind: 'paragraph',
    file,
    ref: refOf(file, block.id),
    key: block.id ? `${file.path}#^${block.id}` : `${file.path}#L${block.start}`,
    register: REVISIT_REGISTER,
    text,
    ...facts,
    line: block.start,
  };
}
