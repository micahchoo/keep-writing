import { describe, expect, test } from 'bun:test';
import { ExtractionCache } from '../src/extraction-cache';
import { AnsweredIndex } from '../src/answered';
import { fillJars } from '../src/bank';
import { fakeVault } from './fake-vault';
import { headingAbove } from '../src/furniture';

const prose = 'I remember the light in the room and how it changed what I wanted to say to everyone.';
function fixture() {
  let reads = 0;
  const v = fakeVault({
    'Pieces/a.md': `${prose} ^a`, 'Pieces/z.md': `${prose} ^z`,
    'Elsewhere/out.md': `${prose} ^out`,
    'Bank/q.md': '---\nkind: bank\n---\n\n- what changed? ^q',
  }, { beforeRead: () => { reads++; } });
  const extraction = new ExtractionCache();
  const ctx = { app: v.app, extraction, bankFolder: 'Bank', sittingsFolder: 'Sittings', writingFolders: ['Pieces'], index: new AnsweredIndex(v.app), skipped: new Set<string>() };
  return { v, extraction, ctx, reads: () => reads };
}

describe('scoped extraction', () => {
  test('a target survives unrelated duplicate text and reads only itself', async () => {
    const { v, ctx, reads } = fixture();
    expect((await fillJars(ctx, v.file('Pieces/z.md'))).paragraphs.map(p => p.key)).toEqual(['Pieces/z.md#^z']);
    expect(reads()).toBe(1);
    await fillJars(ctx, v.file('Pieces/z.md'));
    expect(reads()).toBe(1);
    expect((await fillJars(ctx, v.file('Elsewhere/out.md'))).paragraphs).toEqual([]);
    expect(reads()).toBe(1);
  });

  test('warm roaming reuses bank and paragraphs but retains draw-time filtering', async () => {
    const { ctx, reads } = fixture();
    expect((await fillJars(ctx, null)).paragraphs.map(p => p.key)).toEqual(['Pieces/a.md#^a']);
    expect(reads()).toBe(3);
    ctx.skipped.add('Pieces/a.md#^a');
    const warm = await fillJars(ctx, null);
    expect(warm.paragraphs).toEqual([]);
    expect(reads()).toBe(3);
  });

  test('content and metadata invalidation reload only the changed file', async () => {
    const { v, extraction, ctx, reads } = fixture();
    await fillJars(ctx, null);
    await v.app.vault.process(v.file('Pieces/z.md'), () => `## References\n\n${prose} changed ^z`);
    extraction.invalidate('Pieces/z.md');
    ctx.index.invalidate(v.file('Pieces/z.md'));
    expect((await fillJars(ctx, v.file('Pieces/z.md'))).paragraphs).toEqual([]);
    expect(reads()).toBe(4);
    await fillJars(ctx, null);
    expect(reads()).toBe(4);
    await v.app.vault.process(v.file('Bank/q.md'), () => '---\nkind: bank\n---\n\n- a new question? ^q');
    extraction.invalidate('Bank/q.md');
    ctx.index.invalidate(v.file('Bank/q.md'));
    expect((await fillJars(ctx, null)).bank[0].text).toBe('a new question?');
    expect(reads()).toBe(5);
  });

  test('rename and delete discard old file entries and disposal releases retained extraction', async () => {
    const cache = new ExtractionCache();
    let reads = 0;
    const load = async () => ++reads;
    await cache.get('old.md', 'paragraphs', load);
    cache.invalidate('old.md');
    await cache.get('new.md', 'paragraphs', load);
    cache.invalidate('new.md');
    expect(await cache.get('new.md', 'paragraphs', load)).toBe(3);
    cache.dispose();
    await expect(cache.get('new.md', 'paragraphs', load)).rejects.toThrow('unloaded');
    expect(reads).toBe(3);
  });

  test('an edit during extraction never publishes the obsolete result', async () => {
    const cache = new ExtractionCache();
    let release!: (v: string) => void;
    let calls = 0;
    const pending = cache.get('x.md', 'paragraphs', () => ++calls === 1 ? new Promise<string>(r => { release = r; }) : Promise.resolve('current'));
    cache.invalidate('x.md');
    release('obsolete');
    expect(await pending).toBe('current');
    expect(calls).toBe(2);
  });
});

test('nearest-heading lookup preserves nested boundaries with logarithmic work', () => {
  const v = fakeVault({ 'x.md': '## First\n\nWords.\n\n### Nested\n\nMore words.\n' });
  const cache = v.app.metadataCache.getFileCache(v.file('x.md'))!;
  expect(headingAbove(null, 0)).toBe('');
  expect(headingAbove(cache, -1)).toBe('');
  expect(headingAbove(cache, 3)).toBe('first');
  expect(headingAbove(cache, 4)).toBe('nested');
  let visits = 0;
  cache.headings = Array.from({ length: 10000 }, (_, i) => ({
    heading: String(i), level: 2,
    get position() { visits++; return { start: { line: i * 2, col: 0, offset: 0 }, end: { line: i * 2, col: 0, offset: 0 } }; },
  }));
  for (let i = 0; i < 10000; i++) expect(headingAbove(cache, i * 2 + 1)).toBe(String(i));
  expect(visits).toBeLessThanOrEqual(140000);
});

test('warm cached extraction respects answered links written after the draw', async () => {
  const { v, ctx, reads } = fixture();
  await fillJars(ctx, null);
  await v.app.vault.create('Sittings/answer.md', '---\nanswers:\n  - "[[Pieces/a#^a]]"\n---\n');
  ctx.index.invalidate();
  expect((await fillJars(ctx, null)).paragraphs).toEqual([]);
  expect(reads()).toBe(3);
});

test('renamed and deleted candidates cannot survive cached extraction', async () => {
  const { ctx, extraction } = fixture();
  await fillJars(ctx, null);
  const renamed = fakeVault({ 'Pieces/new.md': `${prose} ^a` });
  extraction.invalidate('Pieces/a.md');
  extraction.invalidate('Pieces/new.md');
  ctx.app = renamed.app;
  ctx.index = new AnsweredIndex(renamed.app);
  expect((await fillJars(ctx, null)).paragraphs.map(p => p.ref.path)).toEqual(['Pieces/new']);
  extraction.invalidate('Pieces/new.md');
  ctx.index.remove('Pieces/new.md');
  ctx.app = fakeVault({}).app;
  expect((await fillJars(ctx, null)).paragraphs).toEqual([]);
});

test('in-flight renamed extraction retries using the new path', async () => {
  const cache = new ExtractionCache();
  const v = fakeVault({ 'old.md': prose });
  const file = v.file('old.md');
  let release!: (value: string) => void;
  let calls = 0;
  const load = () => ++calls === 1 ? new Promise<string>(resolve => { release = resolve; }) : Promise.resolve(file.path);
  const pending = cache.get(file, 'paragraphs', load);
  file.path = 'new.md';
  cache.invalidate('old.md');
  release('old.md');
  expect(await pending).toBe('new.md');
  expect(await cache.get(file, 'paragraphs', load)).toBe('new.md');
  expect(calls).toBe(2);
});
