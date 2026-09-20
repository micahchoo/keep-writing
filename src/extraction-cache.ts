import type { TFile } from 'obsidian';

export class ExtractionStopped extends Error {
  constructor() { super('Keep Writing has been unloaded.'); }
}

/** Parsed file facts only: answered, skipped and folder eligibility remain draw-time decisions. */
export class ExtractionCache {
  private entries = new Map<string, Map<string, Promise<unknown>>>();
  private disposed = false;

  get isDisposed(): boolean { return this.disposed; }

  assertActive(): void { if (this.disposed) throw new ExtractionStopped(); }

  async get<T>(source: TFile | string, kind: string, load: () => Promise<T>): Promise<T> {
    const path = typeof source === 'string' ? source : source.path;
    this.assertActive();
    let file = this.entries.get(path);
    if (!file) {
      file = new Map();
      this.entries.set(path, file);
    }
    let pending = file.get(kind) as Promise<T> | undefined;
    if (!pending) {
      pending = load();
      file.set(kind, pending);
    }
    try {
      const value = await pending;
      this.assertActive();
      // A read started before an edit must not escape as a current result.
      if (!this.disposed && this.entries.get(path) !== file) return this.get(source, kind, load);
      return value;
    } catch (error) {
      this.assertActive();
      if (this.entries.get(path) !== file) return this.get(source, kind, load);
      if (file.get(kind) === pending) file.delete(kind);
      throw error;
    }
  }

  invalidate(path: string): void {
    this.entries.delete(path);
  }

  clear(): void { this.entries.clear(); }

  dispose(): void {
    this.disposed = true;
    this.entries.clear();
  }
}
