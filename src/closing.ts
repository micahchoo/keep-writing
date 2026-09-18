// The Closing: the two moves at the end of a Sitting, the Bank entries tagged
// `#role/door` and `#role/bookmark`. See CONTEXT.md, "Closing" and "Role".
//
// Open door — "what did we not touch today?" — is an ordinary question with an
// ordinary answer; what is volunteered is the best material a Sitting gets,
// and nothing more has to happen to it.
//
// Bookmark — "where should we pick up?" — is the one whose answer is written
// somewhere else: as `next` on the Sitting's Target, or on `me` when roaming,
// so the next Sitting can open at the owner's own edge.
//
// This lived inside `markAnswered` until 2026-09-16, which is why asks.ts —
// a callout parser — imported the Bank and the Target. A third Closing move
// would have needed a third branch in there. Now it needs a line here.

import type { App, TFile } from 'obsidian';
import { questionAt } from './bank';
import type { Role } from './bank';
import { wikilink } from './refs';
import type { Ref } from './refs';
import { ME_BASENAME, readTarget } from './target';

/**
 * Run whatever Closing move an answered source calls for. `source` is what the
 * Ask cited; `answer` is the block just marked done. Returns the move that
 * ran, or null when the source was an ordinary Bank question or a paragraph.
 *
 * A role is declared on the entry, never by the file it sits in, so a closing
 * move is legal in any Bank note.
 */
export async function runClosing(
  app: App,
  sitting: TFile,
  source: Ref,
  answer: Ref,
  bankFolder: string,
): Promise<Role | null> {
  const question = await questionAt(app, source, sitting.path, bankFolder);
  const role = question?.role ?? null;
  if (role === 'bookmark') await writeBookmark(app, sitting, answer);
  return role;
}

/** The bookmark lands on the Sitting's Target, or on `me` when roaming. */
async function writeBookmark(app: App, sitting: TFile, answer: Ref): Promise<void> {
  const target = readTarget(app, sitting);
  const home = target?.file ?? app.vault.getFileByPath(`${ME_BASENAME}.md`);
  if (!home) return;
  await app.fileManager.processFrontMatter(home, (fm: Record<string, unknown>) => {
    fm['next'] = wikilink(answer);
  });
}
