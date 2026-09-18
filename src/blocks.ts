// The one permitted body edit: append ` ^id` to the last line of a paragraph.
// Never changes an existing character.

import type { App, CachedMetadata, TFile } from 'obsidian';
import { Refused } from './refusal';
import { newBlockId, refOf } from './refs';
import type { Ref } from './refs';

/** Section types where an inline ` ^id` on the last line is valid markdown. */
const ID_INLINE_TYPES = new Set(['paragraph', 'list', 'heading']);

export interface Paragraph {
  /** First line of the paragraph (0-based). */
  start: number;
  /** Last line of the paragraph (0-based, inclusive). */
  end: number;
  id?: string;
  type: string;
}

/** The paragraph (section, or list item inside a list) that contains `line`. */
export function paragraphAt(cache: CachedMetadata | null, line: number): Paragraph | null {
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

/**
 * Give the paragraph containing `line` a block id if it has none, and return
 * a ref to it. Throws NotAParagraph if the line is not inside a paragraph,
 * list item or heading.
 */
export async function ensureBlockId(app: App, file: TFile, line: number): Promise<Ref> {
  const cache = app.metadataCache.getFileCache(file);
  const para = paragraphAt(cache, line);
  if (!para || !ID_INLINE_TYPES.has(para.type)) {
    throw new NotAParagraph('Put the cursor in a paragraph, list item or heading.');
  }
  if (para.id) return refOf(file, para.id);

  const id = newBlockId(cache);
  await app.vault.process(file, (data) => {
    const lines = data.split('\n');
    const last = lines[para.end];
    if (last === undefined) return data;
    // Guard: the cache may lag the file. Only append if no id is there yet.
    if (/\s\^[A-Za-z0-9-]+\s*$/.test(last)) return data;
    lines[para.end] = last.replace(/\s*$/, '') + ` ^${id}`;
    return lines.join('\n');
  });
  return refOf(file, id);
}
