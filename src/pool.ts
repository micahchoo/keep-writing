// The pool of the owner's own blocks: every paragraph in the vault that
// carries a block id, outside Bank/ and Templates/. Candidates for a
// Proposal are found here (lexically, in code) before bonsai judges them.
//
// The paragraphs of finished Pieces (`^p-NNN`) are in this pool by the same
// rule: they are the owner's words, so a fresh answer may echo, contradict or
// follow one of them. Nothing here is specific to Revisits.

import type { App } from 'obsidian';
import { isBankPath } from './links';
import type { Block } from './lexical';
import { blockText, refOf, formatRef } from './refs';

const TEMPLATES_FOLDER = 'Templates';

export async function blockPool(app: App, bankFolder: string): Promise<Block[]> {
  const pool: Block[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (isBankPath(file.path, bankFolder) || file.path.startsWith(TEMPLATES_FOLDER + '/')) continue;
    const blocks = app.metadataCache.getFileCache(file)?.blocks;
    if (!blocks) continue;
    for (const id of Object.keys(blocks)) {
      const text = await blockText(app, file, id);
      if (text) pool.push({ ref: formatRef(refOf(file, id)), text });
    }
  }
  return pool;
}
