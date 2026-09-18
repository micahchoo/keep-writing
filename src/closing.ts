// The Closing: the two moves at the end of a Sitting. Both are Bank entries
// carried into the Sitting by `Templates/Sitting.md`, under their own heading,
// so they sit at the end of the note and nothing has to draw them.
//
// Open door — "what did we not touch today?" — is an ordinary question with an
// ordinary answer; what is volunteered is the best material a Sitting gets,
// and nothing more has to happen to it. Code does not know it exists.
//
// Bookmark — "where should we pick up?" — is the one whose answer is written
// somewhere else: as `next` on the Sitting's Target, or on `me` when roaming,
// so the next Sitting can open at the owner's own edge. It is the only thing
// here that needs code, and `#role/bookmark` on the entry is what says so.
//
// This lived inside `markAnswered` until 2026-09-16, which is why asks.ts —
// a callout parser — imported the Bank and the Target.

import type { App, TFile } from 'obsidian';
import { questionAt } from './bank';
import { wikilink } from './refs';
import type { Ref } from './refs';
import { ME_BASENAME, readTarget } from './target';

/**
 * Run whatever Closing move an answered source calls for. `source` is what the
 * Ask cited; `answer` is the block just marked done. Returns the role the entry
 * declared, or null when the source was an ordinary Bank question or a
 * paragraph.
 *
 * The role is declared on the entry, never by the file it sits in, so a closing
 * move is legal in any Bank note.
 */
export async function runClosing(
  app: App,
  sitting: TFile,
  source: Ref,
  answer: Ref,
  bankFolder: string,
): Promise<string | null> {
  const question = await questionAt(app, source, sitting.path, bankFolder);
  const role = question?.role ?? null;
  if (role === 'bookmark') await writeBookmark(app, sitting, answer);
  return role;
}

/** The bookmark lands on the Sitting's Target, or on `me` when roaming. */
async function writeBookmark(app: App, sitting: TFile, answer: Ref): Promise<void> {
  const target = readTarget(app, sitting);
  const home = target ?? app.vault.getFileByPath(`${ME_BASENAME}.md`);
  if (!home) return;
  await app.fileManager.processFrontMatter(home, (fm: Record<string, unknown>) => {
    fm['next'] = wikilink(answer);
  });
}
