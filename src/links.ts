// The one typed link: an answer says what it `answers`, as a wikilink in a
// frontmatter property, so one write lands in the link graph, the backlink
// pane, the properties sidebar and any Base that asks. The source's end is the
// backlink pane's; `answered-by` was written there too until 2026-09-24.
//
// There were five relations until 2026-09-17 — `echoes`, `contradicts`,
// `follows` and `demonstrates` beside this one — with an inverse table, a
// symmetric-relation rule, a reader that merged the two views of one link, and
// a command for writing one by hand. The vault held exactly ONE of them after
// its whole life. The model that proposed them could not hold enough context
// to be right, and the pane that displayed them is gone; Obsidian's own
// backlink pane and smart-connections cover what they were for.
//
// `answers` stays because it is not a nicety: it is what makes a source
// answered, which is what stops the draw handing it back.

import type { App, TFile } from 'obsidian';
import { formatRef, keyOfRef, linksNamed, parseRef, resolveRef, wikilink } from './refs';
import type { Ref } from './refs';

/** Written on the answer block's note. */
export const ANSWERS = 'answers';
/**
 * The source keys one note says it `answers`, resolved.
 *
 * Read at two scopes, on purpose — `answeredInVault` unions it over the whole
 * vault, which is the canon's rule ("a source is answered when any block
 * carries an `answers` link to it"), and `asks.ts#asksOf` takes one Sitting's
 * own, because an answer lands in the Sitting that holds the Ask and a vault
 * scan on every keystroke is not worth a case that cannot arise. The SCOPES
 * differ; the reading is one.
 */
export function answeredKeys(app: App, file: TFile): string[] {
  const keys: string[] = [];
  for (const fl of linksNamed(app.metadataCache.getFileCache(file), ANSWERS)) {
    const ref = parseRef(fl.link);
    const key = ref && keyOfRef(app, ref, file.path);
    if (key) keys.push(key);
  }
  return keys;
}

/**
 * Every source some note says it `answers`, read off the metadata cache when a
 * draw asks. No file is read. An index kept this set current after every save
 * of every note until 2026-09-24; Obsidian's cache already is that index.
 */
export function answeredInVault(app: App): Set<string> {
  const keys = new Set<string>();
  for (const file of app.vault.getMarkdownFiles()) for (const key of answeredKeys(app, file)) keys.add(key);
  return keys;
}

function asList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return [v];
  if (typeof v === 'number' || typeof v === 'boolean') return [String(v)];
  return [];
}

function sameRef(a: string, b: Ref): boolean {
  const pa = parseRef(a);
  return !!pa && formatRef(pa) === formatRef(b);
}

async function addToProperty(app: App, file: TFile, key: string, ref: Ref): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    const list = asList(fm[key]);
    if (list.some((v) => sameRef(v, ref))) return;
    list.push(wikilink(ref));
    fm[key] = list;
  });
}

/**
 * Link an answer to what provoked it: `answers` on the answer's note. Adding a
 * link that is already there changes nothing, which is what lets an answer be
 * marked twice. The source's note is not written.
 */
export async function linkAnswer(app: App, answer: Ref, source: Ref): Promise<void> {
  const from = resolveRef(app, answer);
  if (!from) throw new Error(`Answer note not found: ${answer.path}`);
  await addToProperty(app, from.file, ANSWERS, source);
}
