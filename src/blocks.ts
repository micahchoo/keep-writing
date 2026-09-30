// The one permitted body edit: append ` ^id` to the last line of an ANSWER's
// first paragraph. Never changes an existing character. A source is never
// written: it is addressed by the id it carries, or by a virtual one.
//
// One writer. There were two until 2026-09-21: `ensureBlockId(app, file, line)`
// carried the tests and had no caller; `ensureSourceBlockId` shipped and had
// none. The tests measured the twin that did not ship.

import type { App, CachedMetadata } from 'obsidian';
import { Refused } from './refusal';
import { isVirtual, newBlockId, paragraphTexts, refOf, stripBlockDecoration, virtualId } from './refs';
import type { Ref } from './refs';
import type { Paragraph as SourceParagraph } from './paragraphs';

type Source = Pick<SourceParagraph, 'file' | 'ref' | 'text' | 'selectionSnapshot'>;

/** Where a source is now, checked against what was offered. Throws when it changed. */
interface Located {
  content: string;
  lines: string[];
  cache: CachedMetadata | null;
  para: BlockSpan;
  raw: string;
  /** The id the block already carries in the note. */
  present?: string;
}

const changed = () => new NotAParagraph('The paragraph changed or is ambiguous. Select it again.');

/** Find the block a source names — by its id, or by its unique words — and check it has not changed. */
async function locate(app: App, source: Source): Promise<Located> {
  const content = await app.vault.cachedRead(source.file);
  const cache = app.metadataCache.getFileCache(source.file);
  const lines = content.split('\n');
  const snapshot = source.selectionSnapshot;
  const needle = snapshot?.selected ?? source.text;
  // IDs disambiguate drawn blocks. Unanchored selections require unique text.
  let para: BlockSpan | null;
  if (source.ref.blockId) {
    const block = cache?.blocks?.[source.ref.blockId];
    para = block ? blockAt(cache, block.position.start.line) : null;
  } else {
    const at = content.indexOf(needle);
    if (at < 0 || content.indexOf(needle, at + 1) >= 0) throw changed();
    para = blockAt(cache, content.slice(0, at).split('\n').length - 1);
  }
  if (!para || !ID_INLINE_TYPES.has(para.type)) throw changed();
  const raw = lines.slice(para.start, para.end + 1).join('\n');
  const matches = snapshot?.anchorFirst ? needle.startsWith(raw.trim()) : raw.includes(needle);
  if (snapshot ? !matches : stripBlockDecoration(raw) !== source.text) throw changed();
  if (snapshot?.block !== undefined && !snapshot.anchorFirst && stripBlockDecoration(raw) !== stripBlockDecoration(snapshot.block)) throw changed();
  // A stale range must not split a paragraph that has moved or grown.
  if (para.type === 'paragraph' &&
      ((para.start > 0 && lines[para.start - 1]?.trim()) || lines[para.end + 1]?.trim())) throw changed();
  const present = /\s\^([A-Za-z0-9-]+)\s*$/.exec(raw)?.[1];
  if (source.ref.blockId && present !== source.ref.blockId) throw changed();
  return present ? { content, lines, cache, para, raw, present } : { content, lines, cache, para, raw };
}

/**
 * The address a SOURCE is cited by, and the words to paste under the Ask when
 * the note cannot transclude it. Writes nothing: the id the block carries, or
 * else its virtual id (refs.ts#virtualId). A source must be where it was
 * offered, with the words it was offered with, or this refuses.
 *
 * Until 2026-09-29 a source without an id was given one here, written into the
 * owner's prose. Most owners have no ids and want none written.
 */
export async function addressSource(app: App, source: Source): Promise<{ ref: Ref; text: string }> {
  const wanted = source.ref.blockId;
  const cache = app.metadataCache.getFileCache(source.file);
  if (wanted && isVirtual(cache, wanted)) {
    const block = (await paragraphTexts(app, source.file)).find((b) => b.id === wanted);
    if (!block) throw changed();
    return { ref: refOf(source.file, wanted), text: block.text };
  }
  const { raw, present } = await locate(app, source);
  const text = stripBlockDecoration(raw);
  return { ref: refOf(source.file, present ?? virtualId(text)), text };
}

/**
 * Give the block a real id, appended to its last line. Only an ANSWER is
 * given one (asks.ts#markAnswered), in a Sitting the plugin keeps; a source is
 * addressed by `addressSource` and never written.
 */
export async function ensureSourceBlockId(
  app: App,
  source: Source,
  validate?: (content: string, line: number) => boolean,
): Promise<Ref> {
  const wanted = source.ref.blockId;
  if (wanted && isVirtual(app.metadataCache.getFileCache(source.file), wanted)) return (await addressSource(app, source)).ref;
  const { content, lines, cache, para, present } = await locate(app, source);
  const id = present ?? newBlockId(cache);
  // An id already there and nothing to check inside the write: no write at all.
  if (present && !validate) return refOf(source.file, id);
  await app.vault.process(source.file, (data) => {
    if (data !== content) throw changed();
    if (validate && !validate(data, para.start)) throw changed();
    if (present) return data;
    const last = lines[para.end];
    if (last === undefined || !last.trim()) throw changed();
    const cr = last.endsWith('\r') ? '\r' : '';
    lines[para.end] = (cr ? last.slice(0, -1) : last) + ` ^${id}` + cr;
    return lines.join('\n');
  });
  return refOf(source.file, id);
}

/** Section types where an inline ` ^id` on the last line is valid markdown. */
const ID_INLINE_TYPES = new Set(['paragraph', 'list', 'heading']);

/** The lines one block spans, from the metadata cache. Not paragraphs.ts#Paragraph, which is what the draw offers. */
export interface BlockSpan {
  /** First line of the paragraph (0-based). */
  start: number;
  /** Last line of the paragraph (0-based, inclusive). */
  end: number;
  id?: string;
  type: string;
}

/** The block (section, or list item inside a list) that contains `line`. */
export function blockAt(cache: CachedMetadata | null, line: number): BlockSpan | null {
  const section = cache?.sections?.find(
    (s) => s.position.start.line <= line && line <= s.position.end.line,
  );
  if (!section) return null;
  if (section.type === 'list') {
    const items = (cache?.listItems ?? []).filter(
      (i) => i.position.start.line <= line && line <= i.position.end.line,
    );
    // Innermost item: the one that starts last.
    const item = items.sort((a, b) => b.position.start.line - a.position.start.line)[0];
    if (item) {
      return {
        start: item.position.start.line,
        end: item.position.end.line,
        id: item.id,
        type: 'list',
      };
    }
  }
  return {
    start: section.position.start.line,
    end: section.position.end.line,
    id: section.id,
    type: section.type,
  };
}

/** The cursor is not in something that can carry an inline block id. */
export class NotAParagraph extends Refused {}
