// Answered-ness, over the whole vault: which source blocks some answer
// already points at, so the draw never hands one back. The canon's rule
// (CONTEXT.md): a source is answered when any block carries an `answers` link
// to it. `asks.ts#asksOf` reads the same property at one Sitting's scope, on
// purpose; the reading is one (links.ts#answeredKeys), the scopes differ.
//
// The index also keeps the jars' rows per file, so a draw over a large vault
// re-reads only what changed. Both live here because both are invalidated by
// the same events, in the same order; they lived in bank.ts, beside the Bank
// questions and the Draw, until 2026-09-21.

import type { App, TFile } from 'obsidian';
import { answeredKeys } from './links';
import { isBankNote, loadBank } from './bank';
import type { BankQuestion, Jars } from './bank';
import { paragraphsForFile, oneTellingEachAsync } from './paragraphs';
import type { Paragraph } from './paragraphs';
import type { ExtractionCache } from './extraction-cache';
import { WorkBudget } from './work';

/**
 * Which source blocks are answered: every `answers` frontmatter link in the
 * vault, resolved to its key. A source is answered when any block carries an
 * `answers` link to it. Rebuilt lazily after `invalidate()`.
 */
export class AnsweredIndex {
  private files = new Map<string, TFile>();
  private answers = new Map<string, string[]>();
  private counts = new Map<string, number>();
  private rows = new Map<string, { bank: BankQuestion[]; paragraphs: Paragraph[] }>();
  private pending = new Map<string, number>();
  private initialized = false;
  private revision = 0;
  private scanRevision = 0;
  private config = '';
  private stopped = false;
  private running?: Promise<Jars>;
  private preparing?: Promise<void>;
  private snapshot?: Jars;
  constructor(private app: App) {}

  invalidate(file?: TFile): void {
    if (this.stopped) return;
    this.snapshot = undefined;
    if (!file) { this.initialized = false; this.scanRevision++; this.revision++; return; }
    this.files.set(file.path, file);
    this.updateAnswers(file);
    this.pending.set(file.path, ++this.revision);
  }
  rename(file: TFile, oldPath: string): void {
    this.remove(oldPath); this.invalidate(file);
    // Obsidian resolves updated links per file; changed/resolve events refresh their owners.
    this.initialized = false;
    this.scanRevision++;
  }
  resolve(file: TFile): void { if (!this.stopped) this.updateAnswers(file); }
  remove(path: string): void {
    if (this.stopped) return;
    this.setAnswers(path, []);
    this.files.delete(path); this.answers.delete(path); this.rows.delete(path); this.pending.delete(path);
    this.snapshot = undefined;
    this.revision++;
  }
  dispose(): void {
    this.stopped = true; this.revision++; this.files.clear(); this.answers.clear();
    this.counts.clear(); this.rows.clear(); this.pending.clear(); this.snapshot = undefined;
  }
  private setAnswers(path: string, keys: string[]): void {
    for (const key of this.answers.get(path) ?? []) {
      const count = (this.counts.get(key) ?? 1) - 1;
      if (count) this.counts.set(key, count); else this.counts.delete(key);
    }
    if (keys.length) this.answers.set(path, keys); else this.answers.delete(path);
    for (const key of keys) this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }
  private updateAnswers(file: TFile): void { this.setAnswers(file.path, answeredKeys(this.app, file)); }
  private initialize(): void {
    if (this.initialized || this.stopped) return;
    this.initialized = true;
    const files = this.app.vault.getMarkdownFiles();
    const present = new Set(files.map(file => file.path));
    for (const path of this.files.keys()) if (!present.has(path)) this.remove(path);
    for (const file of files) this.invalidate(file);
  }
  /** Draws prepare answer ownership cooperatively before synchronous membership checks. */
  async prepare(budget = new WorkBudget()): Promise<void> {
    if (this.preparing) await this.preparing;
    if (this.initialized || this.stopped) return;
    const scan = async () => {
      while (!this.initialized && !this.stopped) {
        const revision = this.scanRevision;
        const present = new Set<string>();
        for (const file of this.app.vault.getMarkdownFiles()) {
          await budget.step();
          if (this.stopped) return;
          present.add(file.path);
          this.invalidate(file);
        }
        for (const path of this.files.keys()) {
          await budget.step();
          if (this.stopped) return;
          if (!present.has(path)) this.remove(path);
        }
        if (revision === this.scanRevision) this.initialized = true;
      }
    };
    this.preparing = scan();
    try { await this.preparing; } finally { this.preparing = undefined; }
  }
  has(key: string): boolean { this.initialize(); return this.counts.has(key); }
  get requiresPreparation(): boolean { return !this.initialized && !this.stopped; }
  private async waitForWork(): Promise<void> {
    while (this.running) await this.running;
  }
  async jars(bankFolder: string, sittingsFolder: string, writingFolders: string[], extraction?: ExtractionCache): Promise<Jars> {
    await this.waitForWork();
    const budget = new WorkBudget();
    await this.prepare(budget);
    while (this.running) await this.running;
    if (this.stopped) return { bank: [], paragraphs: [] };
    const config = JSON.stringify([bankFolder, sittingsFolder, writingFolders]);
    if (config === this.config && this.snapshot && !this.pending.size) return this.snapshot;
    const work = async (): Promise<Jars> => {
      if (config !== this.config) {
        this.config = config;
        this.snapshot = undefined;
        for (const file of this.files.values()) {
          await budget.step();
          if (this.stopped) return { bank: [], paragraphs: [] };
          this.pending.set(file.path, ++this.revision);
        }
      }
      for (;;) {
        while (this.pending.size && !this.stopped) {
          // Keep one iterator: restarting after every delete rescans Map tombstones.
          for (const [path, version] of this.pending) {
            await budget.checkpoint();
            if (this.stopped) return { bank: [], paragraphs: [] };
            const file = this.files.get(path);
            if (!file) { this.pending.delete(path); continue; }
            let bank: BankQuestion[], paragraphs: Paragraph[];
            try {
              bank = path.startsWith(bankFolder + '/') && isBankNote(this.app, file) ? await loadBank(this.app, file, extraction, budget) : [];
              paragraphs = await paragraphsForFile(this.app, file, sittingsFolder, writingFolders, extraction, budget);
            } catch (error) {
              if (this.stopped) return { bank: [], paragraphs: [] };
              if (this.pending.get(path) !== version) continue;
              throw error;
            }
            if (this.stopped) return { bank: [], paragraphs: [] };
            if (this.pending.get(path) !== version) continue;
            this.rows.set(path, { bank, paragraphs }); this.pending.delete(path);
          }
        }
        if (this.stopped) return { bank: [], paragraphs: [] };
        if (!this.initialized) { await this.prepare(budget); continue; }
        const revision = this.revision;
        const bank: BankQuestion[] = [];
        for (const row of this.rows.values()) {
          await budget.step();
          for (const question of row.bank) {
            await budget.step();
            bank.push(question);
          }
        }
        function* paragraphs(rows: Iterable<{ paragraphs: Paragraph[] }>) {
          for (const row of rows) yield* row.paragraphs;
        }
        const prose = await oneTellingEachAsync(paragraphs(this.rows.values()), budget);
        if (this.stopped) return { bank: [], paragraphs: [] };
        if (revision !== this.revision) continue;
        return this.snapshot = { bank, paragraphs: prose };
      }
    };
    this.running = work();
    try { return await this.running; } finally { this.running = undefined; }
  }
}
