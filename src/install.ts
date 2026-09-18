// The starter Bank: the questions the plugin ships with, written into the
// vault as real notes.
//
// They are NOTES, not data held inside the plugin, and that is the whole
// design. A question is answered when some block carries an `answers` link to
// it — `asked = linked`, the rule the vault runs on. A question living inside
// main.js has no address to link to, so nothing could ever retire it and the
// draw would hand back the same question forever. Written into `Bank/`, every
// shipped question is a block with an id, like every other source.
//
// Once written they are the OWNER'S notes. Nothing here ever overwrites one:
// this is a migration, not a sync. Same rule as `.bin/import-bank.py`, which
// refuses without `--force` for the same reason — the markdown becomes the
// source of truth the moment the owner can edit it in Obsidian.

import type { App } from 'obsidian';

export interface StarterNote {
  /** File name inside the Bank folder, extension included. */
  name: string;
  /** The note, byte for byte. */
  markdown: string;
}

/** What an install did. Both lists are file names, in the order they were tried. */
export interface Installed {
  written: string[];
  /** Already in the vault, and left exactly as it was. */
  skipped: string[];
}

/** Pure: how many questions a set of starter notes holds — list items with a block id. */
export function questionCount(notes: StarterNote[]): number {
  return notes.reduce((n, note) => n + (note.markdown.match(/^\s*-\s.*\s\^[A-Za-z0-9-]+\s*$/gm)?.length ?? 0), 0);
}

/**
 * Write the starter notes into the Bank folder, making it if it is missing.
 * A note already there is skipped and never read, so running this twice is
 * the same as running it once.
 */
export async function installBank(app: App, bankFolder: string, notes: StarterNote[]): Promise<Installed> {
  if (!app.vault.getFolderByPath(bankFolder)) await app.vault.createFolder(bankFolder);
  const written: string[] = [];
  const skipped: string[] = [];
  for (const note of notes) {
    const path = `${bankFolder}/${note.name}`;
    if (app.vault.getFileByPath(path)) {
      skipped.push(note.name);
      continue;
    }
    await app.vault.create(path, note.markdown);
    written.push(note.name);
  }
  return { written, skipped };
}

/** Pure: one line for the owner about what an install did. */
export function installedLine(result: Installed, bankFolder: string): string {
  const { written, skipped } = result;
  if (written.length === 0) return `The question bank is already in ${bankFolder}.`;
  const kept = skipped.length ? `, and left ${skipped.length} already there` : '';
  return `Wrote ${written.length} question note${written.length === 1 ? '' : 's'} to ${bankFolder}${kept}.`;
}
