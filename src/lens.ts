// The Lens: a note in `Lenses/`, prose, appended to the composition prompt
// verbatim. It tells bonsai where to look. The interviewer's technique is a
// page the owner can edit, which is the whole point of it being a note.
//
// It was chosen by the Well a paragraph came from until 2026-09-17 — craft for
// a Domain, learning for a Learning note, none for the self — which made how a
// paragraph is asked about a property of the folder it sits in.
//
// It is chosen by the PATH now. The owner pointed at this paragraph, so ask
// about it: `craft.md`. The draw handed it over, so do not: `invitation.md`.

import type { App } from 'obsidian';

const LENSES_FOLDER = 'Lenses';

/** The Lens the interviewer reads through: the owner pointed at this paragraph. */
export const CRAFT = 'craft';

/** The Lens the Invitation reads through: the draw found this paragraph. */
export const INVITATION = 'invitation';

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
