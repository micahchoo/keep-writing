// The one typed link: an answer says what it `answers`, and the source says
// what it is `answered-by`. Both are wikilinks in a frontmatter property named
// after the relation, so one write lands in the link graph, the backlink pane,
// the properties sidebar and any Base that asks.
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
/** Written back on the source's note, unless the source is a Bank entry. */
export const ANSWERED_BY = 'answered-by';
/**
 * The KINDS of question a note has answered — `episode`, `belief`, `value` —
 * off the `#register/` tag of each Bank entry it answered.
 *
 * Not a relation, an attribute: it adds no edge and no inverse, so it does not
 * reopen the table CONTEXT.md cut to one row on 2026-09-17. It exists because
 * the register was legible only on the QUESTION, and the question lives in the
 * Bank, where 70% of all answer-links converge — so nothing about what kind of
 * thinking a day held was visible on the day itself. With this, Obsidian's
 * graph colour groups can take `["registers","belief"]` and the graph shows
 * the shape of an interview over years.
 */
export const REGISTERS = 'registers';

/**
 * The source keys one note says it `answers`, resolved.
 *
 * Two modules read it at two scopes, on purpose — `bank.ts#AnsweredIndex`
 * unions it over the whole vault, which is the canon's rule ("a source is
 * answered when any block carries an `answers` link to it"), and
 * `asks.ts#asksOf` takes one Sitting's own, because an answer lands in the
 * Sitting that holds the Ask and a vault scan on every keystroke is not worth
 * a case that cannot arise. The SCOPES differ; the reading is one.
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

export function isBankPath(path: string, bankFolder: string): boolean {
  return path.startsWith(bankFolder + '/');
}

export interface LinkOptions {
  bankFolder: string;
}

function asList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
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

/** Add a plain string to a note's list property, once. */
export async function addToStringList(app: App, file: TFile, key: string, value: string): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    const list = asList(fm[key]);
    if (list.includes(value)) return;
    list.push(value);
    fm[key] = list;
  });
}

/**
 * Link an answer to what provoked it, on both ends: `answers` on the answer's
 * note, `answered-by` on the source's. Adding a link that is already there
 * changes nothing, which is what lets an answer be marked twice.
 *
 * A source in `Bank/` gets no inverse. The backlink pane already shows it, and
 * a bank note must not accumulate hundreds of entries.
 */
export async function linkAnswer(app: App, answer: Ref, source: Ref, opts: LinkOptions): Promise<void> {
  const from = resolveRef(app, answer);
  if (!from) throw new Error(`Answer note not found: ${answer.path}`);
  await addToProperty(app, from.file, ANSWERS, source);

  const target = resolveRef(app, source, from.file.path);
  if (!target || isBankPath(target.file.path, opts.bankFolder)) return;
  await addToProperty(app, target.file, ANSWERED_BY, answer);
}
