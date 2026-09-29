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
//
// A later release can still reach them (`updateBanks`, since 2026-09-28), by
// ADDING lines and nothing else. What makes that safe is that a shipped id is
// an address that only ever grows — `ep-042` is never renumbered or reused —
// so the `shipped` property, the highest id of each prefix a note has been
// given, says exactly what is new. A question the owner deleted is below it
// and stays deleted. The owner starts every update; see CONTEXT.md, "Bank".

import { normalizePath } from 'obsidian';
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
  // The folder is whatever the owner typed into settings; `normalizePath`
  // scrubs it before anything is created under it.
  const folder = normalizePath(bankFolder);
  if (!app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
  const written: string[] = [];
  const skipped: string[] = [];
  for (const note of notes) {
    const path = normalizePath(`${folder}/${note.name}`);
    if (app.vault.getFileByPath(path)) {
      skipped.push(note.name);
      continue;
    }
    const file = await app.vault.create(path, note.markdown);
    const mark = markList(highest(shippedLines(note.markdown)));
    if (mark.length) await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm[MARK] = mark; });
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

// ---------------------------------------------------------------------------
// Updating a Bank the owner already has

/** The frontmatter property that holds a note's mark. */
const MARK = 'shipped';

/** A shipped question's id: two letters, a hyphen, a number, at the end of a list item. `^ep-042`. */
const SHIPPED_LINE = /^\s*-\s.*\s\^([a-z]{2})-(\d+)\s*$/;
const SHIPPED_ID = /^([a-z]{2})-(\d+)$/;

interface ShippedLine {
  id: string;
  prefix: string;
  n: number;
  line: string;
}

/** Highest id per prefix: the prefix, its number, and the id as written. */
type Mark = Map<string, { n: number; id: string }>;

function registerOf(line: string): string | undefined {
  return /#register\/([a-z-]+)/.exec(line)?.[1];
}

function shippedLines(markdown: string): ShippedLine[] {
  return markdown.split('\n').flatMap((line) => {
    const m = SHIPPED_LINE.exec(line);
    if (!m) return [];
    const [, prefix = '', digits = ''] = m;
    return [{ id: `${prefix}-${digits}`, prefix, n: Number(digits), line }];
  });
}

function highest(lines: { prefix: string; n: number; id: string }[], into: Mark = new Map()): Mark {
  for (const l of lines) if (l.n > (into.get(l.prefix)?.n ?? -1)) into.set(l.prefix, { n: l.n, id: l.id });
  return into;
}

function markList(mark: Mark): string[] {
  return [...mark.keys()].sort().map((p) => mark.get(p)?.id ?? '');
}

/**
 * Pure: a stored mark, read clean. Anything that is not a list of prefixed ids
 * is no mark, and so is a list with none in it: the note's own ids stand in.
 */
export function shippedMark(value: unknown): Map<string, number> | null {
  if (!Array.isArray(value)) return null;
  const mark = new Map<string, number>();
  for (const v of value) {
    const m = typeof v === 'string' ? SHIPPED_ID.exec(v.trim()) : null;
    if (!m) continue;
    const [, prefix = '', digits = ''] = m;
    mark.set(prefix, Math.max(Number(digits), mark.get(prefix) ?? -1));
  }
  return mark.size ? mark : null;
}

/**
 * Pure: the mark as written in a note's frontmatter, in either shape Obsidian
 * writes a list (`shipped:` then `  - ae-002` lines, or `shipped: [ae-002]`).
 * Undefined when there is none. Read from the text, not the metadata cache,
 * which can still be indexing when the offer is made at startup.
 */
export function markInText(markdown: string): string[] | undefined {
  const lines = markdown.split('\n');
  if (lines[0]?.trim() !== '---') return undefined;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end < 0) return undefined;
  const at = lines.findIndex((line, i) => i < end && /^shipped:/.test(line));
  if (at < 0) return undefined;
  const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, '');
  const inline = /^shipped:\s*\[(.*)\]\s*$/.exec(lines[at] ?? '');
  if (inline) return (inline[1] ?? '').split(',').map(unquote).filter(Boolean);
  const items: string[] = [];
  for (let i = at + 1; i < end; i++) {
    const item = /^\s+-\s+(.*)$/.exec(lines[i] ?? '');
    if (!item) break;
    items.push(unquote(item[1] ?? ''));
  }
  return items;
}

/** What an update does to one note. `text` is the note unchanged when `added` is 0. */
export interface NoteUpdate {
  text: string;
  added: number;
  /** The mark to store afterwards. */
  mark: string[];
}

/**
 * Pure: the owner's note with every shipped question above its mark added,
 * each after the last line of its prefix AND register — one prefix can span
 * several registers, each under its own heading — then of its prefix, then
 * after the note's last line. No existing line is edited, moved or removed.
 *
 * A question already in the note, wherever the owner moved it, is not added
 * again. With no mark — a note installed before there was one — the highest
 * id still in the note stands in for it, and a prefix with nothing left is
 * skipped: it may have been emptied on purpose, and nothing may come back.
 */
export function updateNote(installed: string, markValue: unknown, shipped: string): NoteUpdate {
  const mine = shippedLines(installed);
  const stored = shippedMark(markValue);
  const threshold = (prefix: string): number =>
    stored ? (stored.get(prefix) ?? 0) : (highest(mine).get(prefix)?.n ?? Infinity);
  const have = new Set(mine.map((l) => l.id));
  const offered = shippedLines(shipped).filter((l) => threshold(l.prefix) !== Infinity);
  const incoming = offered.filter((l) => l.n > threshold(l.prefix) && !have.has(l.id));

  const mark: Mark = new Map();
  if (stored) for (const [p, n] of stored) mark.set(p, { n, id: `${p}-${String(n).padStart(3, '0')}` });
  highest(stored ? [] : mine, mark);
  highest(offered, mark);
  if (incoming.length === 0) return { text: installed, added: 0, mark: markList(mark) };

  const lines = installed.split('\n');
  for (const l of incoming) {
    const register = registerOf(l.line);
    const last = (keep: (line: string) => boolean) => lines.reduce((at, line, i) => (keep(line) ? i : at), -1);
    const samePrefix = (line: string) => SHIPPED_LINE.exec(line)?.[1] === l.prefix;
    let at = register ? last((line) => samePrefix(line) && registerOf(line) === register) : -1;
    if (at < 0) at = last(samePrefix);
    if (at < 0) at = last((line) => line.trim() !== '');
    lines.splice(at + 1, 0, l.line);
  }
  return { text: lines.join('\n'), added: incoming.length, mark: markList(mark) };
}

/** One note an update reached, and how many questions it gained. */
export interface Updated {
  name: string;
  added: number;
}

/**
 * Add each release's new questions to the Bank notes the owner already has.
 * A note that is not installed is not installed by this; one with nothing new
 * is not written. The questions go in with `vault.process`, the owner's note
 * read and written in one step, and the mark after them.
 *
 * `dryRun` counts and writes nothing: the owner is shown how many before
 * anything is added.
 */
export async function updateBanks(
  app: App,
  bankFolder: string,
  notes: StarterNote[],
  options: { dryRun?: boolean } = {},
): Promise<Updated[]> {
  const folder = normalizePath(bankFolder);
  const reached: Updated[] = [];
  for (const note of notes) {
    const file = app.vault.getFileByPath(normalizePath(`${folder}/${note.name}`));
    if (!file) continue;
    const current = await app.vault.cachedRead(file);
    const preview = updateNote(current, markInText(current), note.markdown);
    if (preview.added === 0) continue;
    if (options.dryRun) {
      reached.push({ name: note.name, added: preview.added });
      continue;
    }
    let done = preview;
    await app.vault.process(file, (text) => {
      done = updateNote(text, markInText(text), note.markdown);
      return done.text;
    });
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm[MARK] = done.mark; });
    if (done.added) reached.push({ name: note.name, added: done.added });
  }
  return reached;
}
