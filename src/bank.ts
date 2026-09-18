// Bank questions: list items with a register tag and a block id. Which
// sources are still unanswered, and the Draw.
//
// Two jars. The Bank jar holds questions other people wrote, asked as they
// are. The paragraph jar (paragraphs.ts) holds paragraphs the owner wrote,
// filed under Wells. The draw pulls from one jar or the other, seven draws
// in ten from the Bank.

import type { App, TFile } from 'obsidian';
import { answeredKeys } from './links';
import { refOf, resolveRef, stripBlockDecoration } from './refs';
import type { Ref } from './refs';
import { paragraphJar } from './paragraphs';
import type { Paragraph } from './paragraphs';
import { allWells, isRevisitable } from './target';
import type { Target, Well } from './target';

/**
 * What a Bank entry is for. Absent -- the ordinary jar. A role is declared on
 * the entry, like its register, not by which file the entry sits in: before
 * 2026-09-14 the closing moves were found by the basename `closing.md` and
 * told apart by a bare `#bookmark` tag, so `door` meant "a closing entry
 * without #bookmark" and a third move needed a third branch in `draw`.
 */
export type Role = 'door' | 'bookmark';

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

const NO_REGISTER = 'none';
const REGISTER_PREFIX = '#register/';
const ROLE_PREFIX = '#role/';
const ROLES: readonly string[] = ['door', 'bookmark'];

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
  /** Null for an ordinary question; set for a closing move. */
  role: Role | null;
  bankPath: string;
}

/** What the draw picks: a bank question or a paragraph. */
export type Source = BankQuestion | Paragraph;

const TAG = /(?:^|\s)#[^\s#]+/g;
const DUE = /(?:^|\s)due:\s*\S+/i;

/** Pure: split one bank line into its parts. */
export function parseBankLine(line: string): { text: string; register: string; due?: string; role: Role | null } {
  const tags = (line.match(TAG) ?? []).map((t) => t.trim());
  const register = tags.find((t) => t.startsWith(REGISTER_PREFIX))?.slice(REGISTER_PREFIX.length) ?? NO_REGISTER;
  const named = tags.find((t) => t.startsWith(ROLE_PREFIX))?.slice(ROLE_PREFIX.length);
  const role = named && ROLES.includes(named) ? (named as Role) : null;
  const dueMatch = DUE.exec(line);
  const due = dueMatch ? dueMatch[0].trim().slice('due:'.length).trim() : undefined;
  const text = stripBlockDecoration(line).replace(DUE, '').replace(TAG, '').replace(/\s+/g, ' ').trim();
  return due ? { text, register, due, role } : { text, register, role };
}

/** All questions of one bank note: list items that carry a block id. */
export async function loadBank(app: App, file: TFile): Promise<BankQuestion[]> {
  const cache = app.metadataCache.getFileCache(file);
  const items = (cache?.listItems ?? []).filter((i) => i.id);
  if (items.length === 0) return [];
  const lines = (await app.vault.cachedRead(file)).split('\n');
  const out: BankQuestion[] = [];
  for (const item of items) {
    const id = item.id as string;
    const raw = lines.slice(item.position.start.line, item.position.end.line + 1).join(' ');
    const parts = parseBankLine(raw);
    if (!parts.text) continue;
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
  const qs = await loadBank(app, r.file);
  return qs.find((q) => q.ref.blockId === r.blockId) ?? null;
}

function isBankNote(app: App, file: TFile): boolean {
  return app.metadataCache.getFileCache(file)?.frontmatter?.['kind'] === 'bank';
}

/** Every `Bank/*.md` with `kind: bank`. Roles are read off the entries. */
export function bankNotes(app: App, bankFolder: string): TFile[] {
  return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(bankFolder + '/') && isBankNote(app, f));
}

/**
 * Which source blocks are answered: every `answers` frontmatter link in the
 * vault, resolved to its key. A source is answered when any block carries an
 * `answers` link to it. Rebuilt lazily after `invalidate()`.
 */
export class AnsweredIndex {
  private keys = new Set<string>();
  private dirty = true;

  constructor(private app: App) {}

  invalidate(): void {
    this.dirty = true;
  }

  has(key: string): boolean {
    this.rebuildIfDirty();
    return this.keys.has(key);
  }

  private rebuildIfDirty(): void {
    if (!this.dirty) return;
    this.keys = new Set();
    for (const file of this.app.vault.getMarkdownFiles()) {
      for (const key of answeredKeys(this.app, file)) this.keys.add(key);
    }
    this.dirty = false;
  }
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

/** Which part of the Bank a draw reads: the two jars, or one closing role. */
export type DrawSource = 'target' | Role;

export interface Drawn {
  /** `source.kind` tells a paragraph from a question. */
  source: Source;
  /** The Well a paragraph was drawn through; its Lens frames the Revisit. Absent for questions. */
  well?: Well;
  /** Absolute due date, when a bank question carries one. */
  due?: string;
}

export interface DrawContext {
  /** The Sitting being drawn for; its own blocks are never drawn back the same day. */
  sitting?: TFile;
  app: App;
  bankFolder: string;
  sittingsFolder: string;
  index: AnsweredIndex;
  /** Source keys skipped this session. */
  skipped: Set<string>;
  random?: () => number;
  today?: Date;
}

/** One Well's share of the paragraph jar. */
export interface WellPool {
  well: Well;
  paragraphs: Paragraph[];
}

/**
 * The two jars of CONTEXT.md, filtered to what is still drawable: unanswered,
 * not skipped. This is what the Draw reads. A Closing is not a jar and is not
 * here.
 */
export interface Jars {
  /** Role-less questions. Empty when a Target is set: a Target narrows to paragraphs. */
  bank: BankQuestion[];
  /** Only Wells that still hold a drawable paragraph. */
  wells: WellPool[];
}

/**
 * One read of the Bank: the two jars, and the closing moves beside them.
 * `pickFromJars` and `jarCounts` take the narrower `Jars`, because neither
 * reads a closing move.
 */
export interface BankRead extends Jars {
  /** Role-tagged moves. A Target never narrows these. */
  closings: BankQuestion[];
}

export interface JarCounts {
  questions: number;
  /** Distinct paragraphs: one gathered by two Domains counts once. */
  paragraphs: number;
  wells: number;
}

/** Pure: what the pane's header reports. */
export function jarCounts(jars: Jars): JarCounts {
  const keys = new Set<string>();
  for (const pool of jars.wells) for (const p of pool.paragraphs) keys.add(p.key);
  return { questions: jars.bank.length, paragraphs: keys.size, wells: jars.wells.length };
}

/**
 * Fill the two jars for a Sitting. Roaming (no Target): the whole Bank jar,
 * and the paragraph jar filed under every Well. With a Target: no Bank; the
 * paragraph jar holds that Well's paragraphs only, or, for a finished Piece,
 * its own paragraphs (still filed under the Wells that gather it, for the
 * Lens).
 */
export async function fillJars(ctx: DrawContext, target: Target | null): Promise<BankRead> {
  const drawable = (key: string) => !ctx.index.has(key) && !ctx.skipped.has(key);

  // One read of the Bank, one partition. A Target empties the ordinary jar --
  // the day is spent on one Well's paragraphs -- but never the closing moves:
  // a Sitting ends the same way whether or not it had a Target.
  const loaded: BankQuestion[] = [];
  for (const f of bankNotes(ctx.app, ctx.bankFolder)) loaded.push(...(await loadBank(ctx.app, f)));
  const drawableQuestions = loaded.filter((q) => drawable(q.key));
  const bank = target ? [] : drawableQuestions.filter((q) => q.role === null);
  const closings = drawableQuestions.filter((q) => q.role !== null);

  const today = ctx.sitting?.path;
  let paragraphs = (await paragraphJar(ctx.app, ctx.sittingsFolder)).filter(
    (p) => drawable(p.key) && p.file.path !== today,
  );
  if (target?.kind === 'piece') {
    paragraphs = isRevisitable(ctx.app, target.file) ? paragraphs.filter((p) => p.file.path === target.file.path) : [];
  }
  const wells = target && target.kind !== 'piece' ? [target] : allWells(ctx.app);
  const pools: WellPool[] = [];
  for (const well of wells) {
    const own = paragraphs.filter((p) => p.wells.includes(well.name));
    if (own.length) pools.push({ well, paragraphs: own });
  }
  return { bank, closings, wells: pools };
}

/**
 * Pure: the Draw. Flip a coin between the jars; if one is empty, use the
 * other. From the Bank jar: balance across registers, then uniform. From the
 * paragraph jar: a Well uniformly among those with a drawable paragraph, then
 * a paragraph uniformly within it. Null when both jars are empty.
 */
export function pickFromJars(jars: Jars, random: () => number = Math.random, today: Date = new Date()): Drawn | null {
  const hasBank = jars.bank.length > 0;
  const hasParagraphs = jars.wells.length > 0;
  if (!hasBank && !hasParagraphs) return null;
  const fromBank = hasBank && hasParagraphs ? random() < BANK_SHARE : hasBank;
  if (fromBank) {
    const question = pickOne(jars.bank, random);
    if (!question) return null;
    const drawn: Drawn = { source: question };
    const due = question.due ? parseDue(question.due, today) : null;
    if (due) drawn.due = due;
    return drawn;
  }
  const pool = jars.wells[Math.floor(random() * jars.wells.length)] as WellPool;
  const paragraph = pool.paragraphs[Math.floor(random() * pool.paragraphs.length)] as Paragraph;
  return { source: paragraph, well: pool.well };
}

/** What a draw hands back: the pick, and the jar counts the owner is told. */
export interface Draw {
  drawn: Drawn | null;
  jars: JarCounts;
}

/** What a draw of several hands back: the picks, best-effort, and the counts. */
export interface Drawing {
  drawn: Drawn[];
  jars: JarCounts;
}

/** Take a picked source out of the jars, so the next pick cannot repeat it. */
function removePicked(jars: Jars, drawn: Drawn): void {
  const { key } = drawn.source;
  if (drawn.source.kind === 'question') {
    jars.bank = jars.bank.filter((q) => q.key !== key);
    return;
  }
  for (const pool of jars.wells) pool.paragraphs = pool.paragraphs.filter((p) => p.key !== key);
  jars.wells = jars.wells.filter((pool) => pool.paragraphs.length > 0);
}

/**
 * Draw up to `count` sources at once, each an independent flip between the
 * jars, with what is picked taken out so nothing repeats. Fewer than `count`
 * when the jars run out, which is honest: that is all there is.
 *
 * Several at once is what lets the owner refuse by pressing Escape. The draw
 * handed over exactly one source until 2026-09-17, so refusing it needed a
 * `skipped` set that had to live as long as the interview did.
 */
export async function drawMany(ctx: DrawContext, target: Target | null, count: number): Promise<Drawing> {
  const random = ctx.random ?? Math.random;
  const today = ctx.today ?? new Date();
  const jars = await fillJars(ctx, target);
  const counts = jarCounts(jars);
  const drawn: Drawn[] = [];
  for (let i = 0; i < count; i++) {
    const pick = pickFromJars(jars, random, today);
    if (!pick) break;
    drawn.push(pick);
    removePicked(jars, pick);
  }
  return { drawn, jars: counts };
}

/**
 * Draw the next Ask. `target` draws from the two jars (see fillJars and
 * pickFromJars); `bookmark` and `door` read the closing bank only. The jars
 * are filled either way, so the counts the pane reports are current.
 */
export async function draw(ctx: DrawContext, target: Target | null, source: DrawSource = 'target'): Promise<Draw> {
  const random = ctx.random ?? Math.random;
  const jars = await fillJars(ctx, target);
  const counts = jarCounts(jars);
  if (source === 'target') return { drawn: pickFromJars(jars, random, ctx.today ?? new Date()), jars: counts };
  const question = pickOne(jars.closings.filter((q) => q.role === source), random);
  return { drawn: question ? { source: question } : null, jars: counts };
}
