// The pool of the owner's own blocks: every paragraph in the vault that
// carries a block id, outside Bank/ and Templates/. Candidates for a
// Proposal are found here (lexically, in code) before bonsai judges them.
//
// The paragraphs of finished Pieces (`^p-NNN`) are in this pool by the same
// rule: they are the owner's words, so a fresh answer may echo, contradict or
// follow one of them. Nothing here is specific to Revisits.
//
// Furniture is not the owner's words, so it is not in the pool either
// (paragraphs.ts#isFurniture). Measured 2026-09-16: a resume's
// `- url: /blog/...` line reached the top five candidates for a real answer.
// bonsai declined it, and abstained when nothing fit — but "Bonsai judges,
// code arbitrates" (CONTEXT.md) means the check runs in code where a check
// exists, not on the model behaving well.
//
// The draw's word floor does NOT apply here. The pool is not choosing what to
// put in front of the owner; it holds what a later answer might echo, and a
// short answer is echoable. Only furniture leaves.
//
// A `status: page` note stays in the pool, as the canon says: what leaves is
// furniture at the BLOCK level, in any note.

import type { App } from 'obsidian';
import { isBankPath } from './links';
import type { Block } from './lexical';
import { headingAbove, isFurniture } from './paragraphs';
import { blockText, refOf, formatRef } from './refs';

const TEMPLATES_FOLDER = 'Templates';

export async function blockPool(app: App, bankFolder: string): Promise<Block[]> {
  const pool: Block[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (isBankPath(file.path, bankFolder) || file.path.startsWith(TEMPLATES_FOLDER + '/')) continue;
    const cache = app.metadataCache.getFileCache(file);
    const blocks = cache?.blocks;
    if (!blocks) continue;
    for (const id of Object.keys(blocks)) {
      const text = await blockText(app, file, id);
      if (!text) continue;
      if (isFurniture(text, headingAbove(cache, blocks[id]!.position.start.line))) continue;
      pool.push({ ref: formatRef(refOf(file, id)), text });
    }
  }
  return pool;
}
