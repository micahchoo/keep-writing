// A vault small enough to hold in one object. Notes are plain markdown; the
// metadata cache (frontmatter, links in it, sections, list items, blocks) is
// derived the way Obsidian would derive it, for the shapes this plugin reads.
// `vault.process` edits the note in place and records the write.

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

function cacheOf(markdown: string) {
  const lines = markdown.split('\n');
  const { frontmatter, end } = parseFrontmatter(lines);
  const sections: { type: string; id?: string; position: Pos }[] = [];
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
  return { frontmatter, frontmatterLinks, sections, listItems, blocks, tags };
}

export interface FakeVault {
  app: App;
  file(path: string): TFile;
  text(path: string): string;
  /** Every `vault.process` write: the path and the new text. */
  writes: { path: string; text: string }[];
}

export function fakeVault(notes: Record<string, string>): FakeVault {
  const bodies = new Map(Object.entries(notes));
  const files = [...bodies.keys()].map(
    (path) => ({ path, basename: path.replace(/^.*\//, '').replace(/\.md$/, ''), extension: 'md' }) as TFile,
  );
  const byPath = new Map(files.map((f) => [f.path, f]));
  const writes: { path: string; text: string }[] = [];
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (f: TFile) => bodies.get(f.path) ?? '',
      getFileByPath: (path: string) => byPath.get(path) ?? null,
      process: async (f: TFile, fn: (data: string) => string) => {
        const next = fn(bodies.get(f.path) ?? '');
        bodies.set(f.path, next);
        writes.push({ path: f.path, text: next });
        return next;
      },
    },
    metadataCache: {
      getFileCache: (f: TFile) => (bodies.has(f.path) ? cacheOf(bodies.get(f.path) as string) : null),
      getFirstLinkpathDest: (link: string) =>
        byPath.get(`${link}.md`) ?? files.find((f) => f.basename === link || f.path === link) ?? null,
    },
  } as unknown as App;
  return {
    app,
    file: (path) => byPath.get(path) as TFile,
    text: (path) => bodies.get(path) ?? '',
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
