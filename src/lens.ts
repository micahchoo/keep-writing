// The Lens: a note in `Lenses/`, prose, that tells bonsai where to look when
// composing from a paragraph of a given Well. Its body is appended to the
// composition prompt verbatim. `Lenses/craft.md` for Domains,
// `Lenses/learning.md` for Learning notes; the self has no Lens.

import type { App } from 'obsidian';
import type { Well } from './target';

const LENSES_FOLDER = 'Lenses';

const LENS_OF: Record<Well['kind'], string | null> = {
  me: null,
  domain: 'craft',
  learning: 'learning',
};

/** The name of the Lens a Well reads through (`craft`, `learning`), or null for the self. */
export function lensName(well: Well): string | null {
  return LENS_OF[well.kind];
}

/**
 * The body of the Well's Lens, after the frontmatter, trimmed. Empty for the
 * self, or when the Lens note is missing or has no prose. Read fresh each
 * time: it is one small file, and the owner edits it.
 */
export async function lensFor(app: App, well: Well): Promise<string> {
  const name = lensName(well);
  if (!name) return '';
  const file = app.vault.getFileByPath(`${LENSES_FOLDER}/${name}.md`);
  if (!file) return '';
  return bodyOf(await app.vault.cachedRead(file));
}

/** Pure: the text after a leading `---` frontmatter block, trimmed. */
export function bodyOf(markdown: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  return (m ? markdown.slice(m[0].length) : markdown).trim();
}
