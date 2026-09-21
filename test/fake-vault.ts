// A vault small enough to hold in one object. Notes are plain markdown; the
// metadata cache (frontmatter, links in it, sections, headings, list items,
// blocks) is
// derived the way Obsidian would derive it, for the shapes this plugin reads.
//
// It is an adapter for Obsidian's `App`, and it covers both halves of what the
// plugin does through that seam: the reads, and the whole write surface —
// `vault.process` (a block id), `fileManager.processFrontMatter` (every typed
// Link, and the Bookmark's `next`) and `vault.create` (today's Sitting), plus
// `vault.read`, which unmark.ts wants uncached. Every
// write is recorded in `writes`. Before 2026-09-16 the frontmatter write was
// missing, and `src/links.ts` — 220 lines carrying "every relation is written
// on both ends" — could not be reached by a test at all.

import type { App, TFile } from 'obsidian';

type Pos = { start: { line: number; col: number; offset: number }; end: { line: number; col: number; offset: number } };
const pos = (start: number, end: number): Pos => ({
  start: { line: start, col: 0, offset: 0 },
  end: { line: end, col: 0, offset: 0 },
});

const ID_AT_END = /(?:\s|^)\^([A-Za-z0-9-]+)\s*$/;

function parseFrontmatter(lines: string[]): { frontmatter: Record<string, unknown>; end: number } {
  if (lines[0] !== '---') return { frontmatter: {}, end: -1 };
  const fm: Record<string, unknown> = {};
  let i = 1;
  let key: string | null = null;
  for (; i < lines.length && lines[i] !== '---'; i++) {
    const line = lines[i] as string;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) {
      (fm[key] as unknown[]).push(unquote(item[1] as string));
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    key = kv[1] as string;
    const raw = (kv[2] as string).trim();
    if (raw === '') fm[key] = [];
    else if (raw.startsWith('[') && raw.endsWith(']')) fm[key] = raw.slice(1, -1).split(',').map((v) => unquote(v.trim()));
    else fm[key] = unquote(raw);
  }
  return { frontmatter: fm, end: i };
}

function unquote(v: string): string {
  return /^["'].*["']$/.test(v) ? v.slice(1, -1) : v;
}

/** A wikilink or anything with YAML punctuation in it goes back out quoted. */
function quoteIfNeeded(v: string): string {
  return /^\[\[|[:#]/.test(v) ? `"${v}"` : v;
}

/**
 * Write a frontmatter object back into a note, in the shape `parseFrontmatter`
 * reads: scalars inline, lists as `key:` then indented `- item` lines. Creates
 * the block when the note has none, and drops it when nothing is left.
 */
function writeFrontmatter(markdown: string, fm: Record<string, unknown>): string {
  const lines = markdown.split('\n');
  const { end } = parseFrontmatter(lines);
  const body = end >= 0 ? lines.slice(end + 1) : lines;
  const keys = Object.keys(fm);
  if (keys.length === 0) return body.join('\n');
  const head = ['---'];
  for (const key of keys) {
    const value = fm[key];
    if (Array.isArray(value)) {
      head.push(`${key}:`);
      for (const v of value) head.push(`  - ${quoteIfNeeded(String(v))}`);
    } else {
      head.push(`${key}: ${quoteIfNeeded(String(value))}`);
    }
  }
  head.push('---');
  return [...head, ...body].join('\n');
}

function cacheOf(markdown: string) {
  const lines = markdown.split('\n');
  const { frontmatter, end } = parseFrontmatter(lines);
  const sections: { type: string; id?: string; position: Pos }[] = [];
  const headings: { heading: string; level: number; position: Pos }[] = [];
  const listItems: { id?: string; parent: number; position: Pos }[] = [];
  const blocks: Record<string, { id: string; position: Pos }> = {};
  const tags: { tag: string; position: Pos }[] = [];
  const frontmatterLinks: { key: string; link: string; original: string; displayText?: string }[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    const values = Array.isArray(value) ? value.map(String) : [String(value)];
    values.forEach((v, i) => {
      const m = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(v);
      if (!m) return;
      const link = m[1] as string;
      const entry = { key: values.length > 1 ? `${key}.${i}` : key, link, original: v, displayText: m[2] ?? link };
      frontmatterLinks.push(entry);
    });
  }

  if (end >= 0) sections.push({ type: 'yaml', position: pos(0, end) });
  let i = end + 1;
  while (i < lines.length) {
    if ((lines[i] as string).trim() === '') {
      i++;
      continue;
    }
    const start = i;
    while (i + 1 < lines.length && (lines[i + 1] as string).trim() !== '') i++;
    const chunk = lines.slice(start, i + 1);
    const first = chunk[0] as string;
    const type = /^#{1,6}\s/.test(first) ? 'heading' : /^\s*[-*+]\s/.test(first) ? 'list' : first.startsWith('>') ? 'blockquote' : first.startsWith('```') ? 'code' : 'paragraph';
    const section: { type: string; id?: string; position: Pos } = { type, position: pos(start, i) };
    if (type === 'heading') {
      const h = /^(#{1,6})\s+(.*)$/.exec(first) as RegExpExecArray;
      headings.push({ heading: (h[2] as string).trim(), level: (h[1] as string).length, position: pos(start, start) });
    }
    if (type === 'list') {
      chunk.forEach((line, j) => {
        const item: { id?: string; parent: number; position: Pos } = { parent: -start, position: pos(start + j, start + j) };
        const id = ID_AT_END.exec(line)?.[1];
        if (id) {
          item.id = id;
          blocks[id] = { id, position: item.position };
        }
        listItems.push(item);
      });
    } else {
      const id = ID_AT_END.exec(chunk[chunk.length - 1] as string)?.[1];
      if (id) {
        section.id = id;
        blocks[id] = { id, position: section.position };
      }
    }
    for (const m of chunk.join(' ').matchAll(/(?:^|\s)(#[^\s#^]+)/g)) tags.push({ tag: m[1] as string, position: section.position });
    sections.push(section);
    i++;
  }
  return { frontmatter, frontmatterLinks, sections, headings, listItems, blocks, tags };
}

export interface FakeVault {
  app: App;
  file(path: string): TFile;
  text(path: string): string;
  /** The frontmatter of a note as the cache reads it back. */
  frontmatter(path: string): Record<string, unknown>;
  /** Every write, in order: a block id, a frontmatter property, or a new note. */
  writes: { path: string; text: string }[];
}

/** Hooks for tests that need to control WHEN a read lands, not just what it returns. */
export interface VaultHooks {
  /**
   * Awaited before every `cachedRead`. Lets a test hold one read open while
   * another completes, which is the only way to land two vault-reading calls
   * out of the order they were made.
   */
  beforeRead?: (path: string) => Promise<void> | void;
}

export function fakeVault(notes: Record<string, string>, hooks: VaultHooks = {}): FakeVault {
  const bodies = new Map(Object.entries(notes));
  const folders = new Set<string>();
  const fileOf = (path: string): TFile =>
    ({ path, basename: path.replace(/^.*\//, '').replace(/\.md$/, ''), extension: 'md' }) as TFile;
  const files = [...bodies.keys()].map(fileOf);
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const path of bodies.keys()) {
    const slash = path.lastIndexOf('/');
    if (slash > 0) folders.add(path.slice(0, slash));
  }
  const writes: { path: string; text: string }[] = [];
  const record = (path: string, text: string) => {
    bodies.set(path, text);
    writes.push({ path, text });
  };
  const resolve = (link: string): TFile | null =>
    byPath.get(`${link}.md`) ?? files.find((f) => f.basename === link || f.path === link) ?? null;

  const app = {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (f: TFile) => {
        await hooks.beforeRead?.(f.path);
        return bodies.get(f.path) ?? '';
      },
      // The uncached read is the same text here: nothing in this vault lags its cache.
      read: async (f: TFile) => {
        await hooks.beforeRead?.(f.path);
        return bodies.get(f.path) ?? '';
      },
      getFileByPath: (path: string) => byPath.get(path) ?? null,
      getFolderByPath: (path: string) => (folders.has(path) ? { path } : null),
      createFolder: async (path: string) => {
        folders.add(path);
      },
      create: async (path: string, data: string) => {
        const f = fileOf(path);
        files.push(f);
        byPath.set(path, f);
        record(path, data);
        return f;
      },
      process: async (f: TFile, fn: (data: string) => string) => {
        const next = fn(bodies.get(f.path) ?? '');
        record(f.path, next);
        return next;
      },
    },
    fileManager: {
      // Obsidian hands the callback a plain object and writes back whatever it
      // leaves behind, including deletions. The note's body is untouched.
      processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const data = bodies.get(f.path) ?? '';
        const { frontmatter } = parseFrontmatter(data.split('\n'));
        fn(frontmatter);
        record(f.path, writeFrontmatter(data, frontmatter));
      },
    },
    metadataCache: {
      getFileCache: (f: TFile) => (bodies.has(f.path) ? cacheOf(bodies.get(f.path) as string) : null),
      getFirstLinkpathDest: (link: string) => resolve(link),
      // Recomputed on read: a link written this tick is resolved on the next.
      // Only frontmatter links, which is where every typed Link lives.
      get resolvedLinks(): Record<string, Record<string, number>> {
        const out: Record<string, Record<string, number>> = {};
        for (const f of files) {
          const counts: Record<string, number> = {};
          for (const fl of cacheOf(bodies.get(f.path) ?? '').frontmatterLinks) {
            const dest = resolve(fl.link.split('#')[0] as string);
            if (dest) counts[dest.path] = (counts[dest.path] ?? 0) + 1;
          }
          out[f.path] = counts;
        }
        return out;
      },
    },
  } as unknown as App;
  return {
    app,
    file: (path) => byPath.get(path) as TFile,
    text: (path) => bodies.get(path) ?? '',
    frontmatter: (path) => parseFrontmatter((bodies.get(path) ?? '').split('\n')).frontmatter,
    writes,
  };
}

/** A deterministic random source for balance tests. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random source that replays a fixed sequence. */
export function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] as number;
}
