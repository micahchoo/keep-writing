// Bank questions: list items with a register tag and a block id. Which
// sources are still unanswered, and the Draw.
//
// Two jars. The Bank jar holds questions other people wrote, asked as they
// are. The paragraph jar (paragraphs.ts) holds paragraphs the owner wrote.
// The draw pulls from one jar or the other, seven draws in ten from the Bank.

import type { App, TFile } from 'obsidian';
import { bankKey, bankWeight } from './bank-mix';
import type { BankWeights } from './bank-mix';
import { answeredInVault } from './links';
import { refOf, resolveRef, stripBlockDecoration, virtualId } from './refs';
import type { BlockText, Ref } from './refs';
import { paragraphJar, readBlock } from './paragraphs';
import type { Paragraph, UnreadBlock } from './paragraphs';

/**
 * Share of draws that come from the Bank. Set to 0.7 on 2026-09-13: at an
 * even split the owner rarely saw a Bank question. A draw is an independent
 * toss, so an even split lands in clumps — in a Sitting of eight draws, 73%
 * of the time one jar runs three or more deep. And the Revisit is not the
 * only way the owner's own words come back: every answer marked done offers
 * up to three Follow-ups, which are not draws and do not pass through here.
 * Follow-ups are not Revisits; they are simply extra, and they sit on top of
 * whatever this number gives.
 */
export const BANK_SHARE = 0.7;

/** What `parseBankLine` reports for an entry carrying no `#register/` tag. */
export const NO_REGISTER = 'none';
const REGISTER_PREFIX = '#register/';
const ROLE_PREFIX = '#role/';

export interface BankQuestion {
  kind: 'question';
  ref: Ref;
  /** `Bank/x.md#^id`, for answered-ness lookups. */
  key: string;
  /** Question text without tags, due and block id. */
  text: string;
  register: string;
  /** Raw due as written: `+7d` or a date. */
  due?: string;
  /**
   * What the entry is FOR, off its `#role/` tag: `bookmark`, `door`, or null
   * for the ordinary jar. Declared on the entry, never by the file it sits in,
   * so a closing move is legal in any Bank note. Only `bookmark` means
   * anything to code (closing.ts); the rest is the owner's own taxonomy.
   */
  role: string | null;
  bankPath: string;
}

/** What the draw picks: a bank question or a paragraph. */
export type Source = BankQuestion | Paragraph;

const TAG = /(?:^|\s)#[^\s#]+/g;
const DUE = /(?:^|\s)due:\s*\S+/i;

/** Pure: split one bank line into its parts. */
export function parseBankLine(line: string): { text: string; register: string; due?: string; role: string | null } {
  const tags = (line.match(TAG) ?? []).map((t) => t.trim());
  const register = tags.find((t) => t.startsWith(REGISTER_PREFIX))?.slice(REGISTER_PREFIX.length) ?? NO_REGISTER;
  const role = tags.find((t) => t.startsWith(ROLE_PREFIX))?.slice(ROLE_PREFIX.length) ?? null;
  const dueMatch = DUE.exec(line);
  const due = dueMatch ? dueMatch[0].trim().slice('due:'.length).trim() : undefined;
  const text = stripBlockDecoration(line).replace(DUE, '').replace(TAG, '').replace(/\s+/g, ' ').trim();
  return due ? { text, register, due, role } : { text, register, role };
}

/** The one Bank note where the owner's own questions live. See CONTEXT.md — Custom bank. */
export const CUSTOM_BANK = 'Custom';

/** Pure: is this the Custom bank? By its fixed path, never by its basename alone. */
export function isCustomBank(path: string, bankFolder: string): boolean {
  return path === `${bankFolder.replace(/\/+$/, '')}/${CUSTOM_BANK}.md`;
}

/**
 * All questions of one bank note: list items that carry a block id. In the
 * Custom bank a list item needs none; it is addressed by the Virtual id of its
 * words with tags and `due:` removed, so a tag added later keeps the address
 * and a changed word makes a new question. Everywhere else an id is an address
 * something else holds, and a line without one is not a question.
 */
export async function loadBank(app: App, file: TFile, bankFolder: string): Promise<BankQuestion[]> {
  const cache = app.metadataCache.getFileCache(file);
  const custom = isCustomBank(file.path, bankFolder);
  const items = (cache?.listItems ?? []).filter((i) => custom || i.id);
  if (items.length === 0) return [];
  const lines = (await app.vault.cachedRead(file)).split('\n');
  const out: BankQuestion[] = [];
  for (const item of items) {
    const raw = lines.slice(item.position.start.line, item.position.end.line + 1).join(' ');
    const parts = parseBankLine(raw);
    if (!parts.text) continue;
    const id = item.id ?? virtualId(parts.text);
    const q: BankQuestion = {
      kind: 'question',
      ref: refOf(file, id),
      key: `${file.path}#^${id}`,
      text: parts.text,
      register: parts.register,
      role: parts.role,
      bankPath: file.path,
    };
    if (parts.due) q.due = parts.due;
    out.push(q);
  }
  return out;
}

/** The bank question a ref points at, or null if it is not one. */
export async function questionAt(app: App, ref: Ref, sourcePath: string, bankFolder: string): Promise<BankQuestion | null> {
  const r = resolveRef(app, ref, sourcePath);
  if (!r || !r.blockId || !r.file.path.startsWith(bankFolder + '/')) return null;
  const qs = await loadBank(app, r.file, bankFolder);
  return qs.find((q) => q.ref.blockId === r.blockId) ?? null;
}

/** A note in the Bank folder that says `kind: bank`; anything else there is the owner's. */
export function isBankNote(app: App, file: TFile): boolean {
  return app.metadataCache.getFileCache(file)?.frontmatter?.['kind'] === 'bank';
}

/** Every `Bank/*.md` with `kind: bank`. Roles are read off the entries. */
export function bankNotes(app: App, bankFolder: string): TFile[] {
  return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(bankFolder + '/') && isBankNote(app, f));
}

/** Pure: `+Nd` relative to `today`, or a `YYYY-MM-DD` date. Null if unreadable. */
export function parseDue(raw: string, today: Date): string | null {
  const rel = /^\+(\d+)d$/i.exec(raw.trim());
  if (rel) {
    const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + Number(rel[1])));
    return d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  return null;
}

/**
 * Pure: one of these, uniformly. Null when there are none.
 *
 * Registers do NOT weight the draw. They did until 2026-09-15, when a register
 * was picked first and a question inside it second: the seven autoethnographic
 * registers held 7% of the Bank and took 35% of its draws, five times their
 * weight, purely because they were seven names out of twenty. Balancing by
 * register rewards splitting a subject into more names, which is an accident
 * of the taxonomy rather than a statement about what should be asked.
 *
 * The fix that day was a weight exponent set to 1 — which is arithmetically
 * this function, reached through a group-by and a cumulative roll. It was
 * deleted on 2026-09-17. A register is still what a question is tagged with,
 * and the tag pane still counts them; it is simply not what the draw reads.
 */
export function pickOne<T>(items: T[], random: () => number = Math.random): T | null {
  return items[Math.floor(random() * items.length)] ?? null;
}

interface EligibleBank {
  questions: BankQuestion[];
  weight: number;
}

/** Only banks that still have drawable questions participate in the proportions. */
function eligibleBanks(questions: BankQuestion[], bankFolder: string, weights: BankWeights): EligibleBank[] {
  const banks = new Map<string, EligibleBank>();
  for (const question of questions) {
    const key = bankKey(question.bankPath, bankFolder);
    let bank = banks.get(key);
    if (!bank) {
      const weight = bankWeight(key, weights);
      if (weight <= 0) continue;
      bank = { questions: [], weight };
      banks.set(key, bank);
    }
    bank.questions.push(question);
  }
  return [...banks.values()];
}

function pickFromBanks(banks: EligibleBank[], random: () => number): BankQuestion | null {
  if (banks.length === 0) return null;
  // With one eligible bank there is no bank choice to make.
  if (banks.length === 1) return pickOne(banks[0].questions, random);
  let roll = random() * banks.reduce((sum, bank) => sum + bank.weight, 0);
  for (const bank of banks) {
    if (roll < bank.weight) return pickOne(bank.questions, random);
    roll -= bank.weight;
  }
  return null;
}

/** Choose a bank by its proportion, then a question uniformly within that bank. */
export function pickBankQuestion(questions: BankQuestion[], bankFolder: string, weights: BankWeights = {}, random: () => number = Math.random): BankQuestion | null {
  return pickFromBanks(eligibleBanks(questions, bankFolder, weights), random);
}

export interface Drawn {
  /** `source.kind` tells a paragraph from a question. */
  source: Source;
  /** Absolute due date, when a bank question carries one. */
  due?: string;
  /**
   * This row is the Bookmark's answer: at the end of an earlier Sitting the
   * owner wrote where to pick up, and this is what they wrote. It comes from
   * `next` rather than from either jar, it is offered first, and it is
   * interviewed as `pointed` — they chose it, the draw only remembered.
   */
  pickUp?: true;
}

export interface DrawContext {
  /** The Sitting being drawn for; its own blocks are never drawn back the same day. */
  sitting?: TFile;
  app: App;
  bankFolder: string;
  sittingsFolder: string;
  /** Folders whose paragraphs the draw may reach. */
  writingFolders: string[];
  /** Source keys skipped this session. */
  skipped: Set<string>;
  random?: () => number;
  today?: Date;
  bankShare?: number;
  bankWeights?: BankWeights;
}

/**
 * The two jars of CONTEXT.md, filtered to what is still drawable: unanswered,
 * not skipped. This is what the Draw reads. A Closing is not a jar and is not
 * here.
 *
 * The paragraph jar was a list of Wells, each holding its own paragraphs,
 * until 2026-09-17. It is one flat list now. See `pickFromJars` for what that
 * cost and what it fixed.
 */
export interface Jars<P = UnreadBlock> {
  /** Role-less questions. Empty when a Target is set: a Target narrows to paragraphs. */
  bank: BankQuestion[];
  /** Unread until the draw chooses one: see `drawMany`. */
  paragraphs: P[];
}

export interface JarCounts {
  questions: number;
  paragraphs: number;
}

/** Pure: what the owner is told a draw is choosing among. */
export function jarCounts(jars: Jars<unknown>): JarCounts {
  return { questions: jars.bank.length, paragraphs: jars.paragraphs.length };
}

/**
 * Fill the two jars for a Sitting. Roaming (no Target): the whole Bank jar and
 * every drawable block. With a Target: no Bank, and only the blocks of the one
 * note it names. Answered-ness is read here, off the metadata cache, so a
 * link written a moment ago counts.
 */
export async function fillJars(ctx: DrawContext, target: TFile | null, answered = answeredInVault(ctx.app)): Promise<Jars> {
  const drawable = drawableIn(ctx, answered);
  return {
    bank: (await bankJar(ctx, target, answered)),
    paragraphs: paragraphJar(ctx.app, ctx.writingFolders, target)
      .filter((block) => drawable(block.key) && block.file.path !== ctx.sitting?.path),
  };
}

/** Unanswered and not skipped. A paragraph without an id is asked again once read. */
function drawableIn(ctx: DrawContext, answered: Set<string>): (key: string) => boolean {
  return (key) => !answered.has(key) && !ctx.skipped.has(key);
}

/**
 * The Bank jar alone: every question still drawable, in file order. Empty when
 * a Target is set — the day is spent on one note's paragraphs.
 *
 * A role-tagged entry is never in it: a Closing move is carried into the
 * Sitting by the template, so drawing one would place it twice.
 *
 * Its own function because the Seed wants ONLY this (interview.ts#seed), on a
 * path that must be instant and must never fail.
 */
export async function bankJar(ctx: DrawContext, target: TFile | null, answered = answeredInVault(ctx.app)): Promise<BankQuestion[]> {
  if (target) return [];
  const out: BankQuestion[] = [];
  for (const f of bankNotes(ctx.app, ctx.bankFolder)) {
    if (bankWeight(bankKey(f.path, ctx.bankFolder), ctx.bankWeights ?? {}) <= 0) continue;
    for (const q of await loadBank(ctx.app, f, ctx.bankFolder)) {
      if (q.role === null && !answered.has(q.key) && !ctx.skipped.has(q.key)) out.push(q);
    }
  }
  return out;
}

/**
 * Pure: the Draw. Flip a coin between the jars; if one is empty, use the
 * other. Bank proportions choose a note, then a question uniformly within it;
 * paragraphs stay uniform across the jar. Null when both jars are empty or
 * disabled.
 *
 * The paragraph side picked a Well uniformly and THEN a paragraph inside it
 * until 2026-09-17, to make an untouched Well surface. Measured that day over
 * the real corpus: the self held 36.5% of the jar and took 12.5% of the picks,
 * while "Speculation and Futures" held 1.5% and took the same 12.5% — eight
 * times its weight. That is the register-weighting defect of two days earlier,
 * one level up, and the same fix: a share decided by how many GROUPS exist is
 * not a share at all. Coverage is a real goal and this was the wrong
 * instrument for it; a filter that retires itself would be the right one.
 */
export function pickFromJars<P>(jars: Jars<P>, random: () => number = Math.random, today: Date = new Date(), bankShare = BANK_SHARE, bankFolder = 'Bank', bankWeights: BankWeights = {}): { source: BankQuestion | P; due?: string } | null {
  const banks = eligibleBanks(jars.bank, bankFolder, bankWeights);
  const hasBank = banks.length > 0;
  const hasParagraphs = jars.paragraphs.length > 0;
  if (!hasBank && !hasParagraphs) return null;
  if (hasBank && (!hasParagraphs || random() < bankShare)) {
    const question = pickFromBanks(banks, random);
    if (!question) return null;
    const drawn: { source: BankQuestion; due?: string } = { source: question };
    const due = question.due ? parseDue(question.due, today) : null;
    if (due) drawn.due = due;
    return drawn;
  }
  const paragraph = pickOne(jars.paragraphs, random);
  return paragraph ? { source: paragraph } : null;
}

/** What a draw of several hands back: the picks, best-effort, and the counts. Interview#Drawing adds the Target. */
export interface Draws {
  drawn: Drawn[];
  jars: JarCounts;
}

/** Take one item out of a list, so the next pick cannot repeat it. */
function take<T>(items: T[], item: T): void {
  const at = items.indexOf(item);
  if (at >= 0) items.splice(at, 1);
}

/**
 * Draw up to `count` sources at once, each an independent flip between the
 * jars, with what is picked taken out so nothing repeats. Fewer than `count`
 * when the jars run out, which is honest: that is all there is.
 *
 * A block is read only once it is chosen. When it turns out to be Furniture,
 * the paragraph jar is asked again, not the coin, so the Bank keeps its share.
 *
 * Several at once is what lets the owner refuse by pressing Escape. The draw
 * handed over exactly one source until 2026-09-17, so refusing it needed a
 * `skipped` set that had to live as long as the interview did.
 */
export async function drawMany(ctx: DrawContext, target: TFile | null, count: number): Promise<Draws> {
  const random = ctx.random ?? Math.random;
  const today = ctx.today ?? new Date();
  const answered = answeredInVault(ctx.app);
  const drawable = drawableIn(ctx, answered);
  const jars = await fillJars(ctx, target, answered);
  const counts = jarCounts(jars);
  const reads = new Map<string, Promise<BlockText[]>>();
  const drawn: Drawn[] = [];
  while (drawn.length < count) {
    const pick = pickFromJars(jars, random, today, ctx.bankShare, ctx.bankFolder, ctx.bankWeights);
    if (!pick) break;
    if (pick.source.kind === 'question') {
      take(jars.bank, pick.source);
      drawn.push(pick as Drawn);
      continue;
    }
    let block: UnreadBlock | null = pick.source;
    while (block) {
      take(jars.paragraphs, block);
      const paragraph = await readBlock(ctx.app, ctx.sittingsFolder, block, reads);
      // Its virtual key is known only now: an answered one is put back like Furniture.
      if (paragraph && drawable(paragraph.key)) { drawn.push({ source: paragraph }); break; }
      block = pickOne(jars.paragraphs, random);
    }
  }
  return { drawn, jars: counts };
}
