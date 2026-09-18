// The Lens: a note in `Lenses/`, prose, appended to the composition prompt
// verbatim. It tells bonsai where to look. The interviewer's technique is a
// page the owner can edit, which is the whole point of it being a note.
//
// It was chosen by the Well a paragraph came from until 2026-09-17 — craft for
// a Domain, learning for a Learning note, none for the self. There is one now,
// because the folder a paragraph sits in has nothing to do with how it should
// be asked about. When the second composer lands (the invitation, aimed at the
// owner's present rather than at the old text), the Lens is chosen by the PATH
// instead: one page for the interviewer, one for the invitation.

import type { App } from 'obsidian';

const LENSES_FOLDER = 'Lenses';

/** The Lens the interviewer reads through. */
export const CRAFT = 'craft';

/**
 * The body of the Lens, after the frontmatter, trimmed. Empty when the note is
 * missing or has no prose. Read fresh each time: it is one small file, and the
 * owner edits it.
 */
export async function lensFor(app: App, name: string = CRAFT): Promise<string> {
  const file = app.vault.getFileByPath(`${LENSES_FOLDER}/${name}.md`);
  if (!file) return '';
  return bodyOf(await app.vault.cachedRead(file));
}

/** Pure: the text after a leading `---` frontmatter block, trimmed. */
export function bodyOf(markdown: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  return (m ? markdown.slice(m[0].length) : markdown).trim();
}
