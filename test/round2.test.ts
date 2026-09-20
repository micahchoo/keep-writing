import { describe, expect, test, spyOn } from 'bun:test';
import { ExtractionCache } from '../src/extraction-cache';
import { markAnswered, parseAsks } from '../src/asks';
import { AnsweredIndex } from '../src/bank';
import KeepWritingPlugin from '../src/main';
import { ChoiceModal } from '../src/modals';
import { selectionParagraph } from '../src/selection';
import { fakeVault } from './fake-vault';
import * as paragraphs from '../src/paragraphs';

const answer = '> [!ask] What happened?\n> from [[Bank/q#^q]]\n\nMy original answer.\n';

describe('marking retains the answer and its owning question', () => {
  for (const [name, changed] of [
    ['answer edited', answer.replace('My original answer.', 'Replacement answer.')],
    ['question edited', answer.replace('What happened?', 'What came next?')],
    ['source replaced', answer.replace('Bank/q#^q', 'Bank/other#^other')],
    ['Ask removed', 'My original answer.\n'],
  ]) {
    test(`refuses ${name} with zero writes`, async () => {
      const v = fakeVault({ 'Sittings/day.md': answer, 'Bank/q.md': '- What happened? ^q' });
      const file = v.file('Sittings/day.md');
      const ask = parseAsks(answer)[0];
      await v.app.vault.process(file, () => changed);
      v.writes.length = 0;
      expect((await markAnswered(v.app, file, ask, { bankFolder: 'Bank' })).kind).toBe('refused');
      expect(v.writes).toHaveLength(0);
      expect(v.text(file.path)).toBe(changed);
    });
  }

  test('relocates an unchanged Ask and answer, preserving surrounding text', async () => {
    const v = fakeVault({ 'Sittings/day.md': answer, 'Bank/q.md': '- What happened? ^q' });
    const file = v.file('Sittings/day.md');
    const ask = parseAsks(answer)[0];
    await v.app.vault.process(file, () => `Unrelated preface.\n\n${answer}`);
    expect((await markAnswered(v.app, file, ask, { bankFolder: 'Bank' })).kind).toBe('ok');
    expect(v.text(file.path)).toContain('Unrelated preface.\n\n> [!ask]');
    expect(v.text(file.path)).toMatch(/My original answer\. \^[a-z0-9]{6}/);
  });

  test('list answers retain their first-item anchor and subsequent authored items', async () => {
    const text = answer.replace('My original answer.', '- First answer item.\n- Second answer item.');
    const v = fakeVault({ 'Sittings/day.md': text, 'Bank/q.md': '- What happened? ^q' });
    const result = await markAnswered(v.app, v.file('Sittings/day.md'), parseAsks(text)[0], { bankFolder: 'Bank' });
    expect(result.kind).toBe('ok');
    expect(v.text('Sittings/day.md')).toMatch(/- First answer item\. \^[a-z0-9]{6}\n- Second answer item\./);
  });
});

test('cache disposal prevents pending result delivery and further reads', async () => {
  const cache = new ExtractionCache();
  let release!: (value: string) => void;
  let reads = 0;
  const pending = cache.get('x.md', 'paragraphs', () => { reads++; return new Promise<string>(resolve => { release = resolve; }); });
  cache.dispose();
  release('obsolete');
  await expect(pending).rejects.toThrow('unloaded');
  await expect(cache.get('x.md', 'paragraphs', async () => { reads++; return 'new'; })).rejects.toThrow('unloaded');
  expect(reads).toBe(1);
});

test('an invalidated failed read retries the current generation', async () => {
  const cache = new ExtractionCache();
  let reject!: (error: Error) => void;
  let reads = 0;
  const pending = cache.get('x.md', 'paragraphs', () => ++reads === 1 ? new Promise<string>((_, fail) => { reject = fail; }) : Promise.resolve('current'));
  cache.invalidate('x.md'); reject(new Error('old read failed'));
  expect(await pending).toBe('current');
  expect(reads).toBe(2);
});

test('an offer finishing after unload opens no chooser', async () => {
  const v = fakeVault({ 'x.md': 'A deliberately selected paragraph.\n', 'Sittings/day.md': '## Asked\n' });
  const source = selectionParagraph(v.app, v.file('x.md'), 'A deliberately selected paragraph.', 0, 'Sittings');
  const extraction = new ExtractionCache();
  let release!: (value: { candidates: { question: string }[]; lens: null; error: null }) => void;
  const plugin = Object.create(KeepWritingPlugin.prototype) as KeepWritingPlugin;
  Object.assign(plugin, { app: v.app, extraction, model: { available: false }, interview: { offerFrom: () => new Promise(resolve => { release = resolve; }) } });
  const show = spyOn(ChoiceModal.prototype, 'open').mockImplementation(() => {});
  try {
    const pending = (plugin as unknown as { offer(...args: unknown[]): Promise<void> }).offer(v.file('Sittings/day.md'), source, 'pointed');
    extraction.dispose(); release({ candidates: [{ question: 'What changed?' }], lens: null, error: null });
    await pending;
    expect(show).not.toHaveBeenCalled();
    expect(v.writes).toHaveLength(0);
  } finally { show.mockRestore(); }
});

test('warm incremental jars do no duplicate-classification work until a file changes', async () => {
  const prose = 'I remember the moment clearly because everyone in the room stopped talking when the door opened.';
  let reads = 0;
  const v = fakeVault({ 'Pieces/a.md': `${prose} ^a`, 'Pieces/b.md': `${prose} another time ^b` }, { beforeRead: () => { reads++; } });
  const index = new AnsweredIndex(v.app);
  const classify = spyOn(paragraphs, 'oneTellingEachAsync');
  try {
    await index.jars('Bank', 'Sittings', ['Pieces']);
    const initial = classify.mock.calls.length;
    await index.jars('Bank', 'Sittings', ['Pieces']);
    expect(classify.mock.calls.length).toBe(initial);
    expect(reads).toBe(2);
    await v.app.vault.process(v.file('Pieces/b.md'), () => `${prose} changed ^b`);
    index.invalidate(v.file('Pieces/b.md'));
    expect((await index.jars('Bank', 'Sittings', ['Pieces'])).paragraphs.some(p => p.text.endsWith('changed'))).toBe(true);
    expect(reads).toBe(3);
    expect(classify.mock.calls.length).toBeGreaterThan(initial);
  } finally { classify.mockRestore(); }
});

test('many short files share a cooperative budget instead of resetting it per file', async () => {
  const prose = 'I remember the moment clearly because everyone in the room stopped talking when the door opened.';
  const notes = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`Pieces/${i}.md`, `${prose} ${i} ^p`]));
  const v = fakeVault(notes);
  let clock = 0, yields = 0;
  const now = spyOn(performance, 'now').mockImplementation(() => ++clock);
  const timer = spyOn(window, 'setTimeout').mockImplementation(((callback: () => void) => { yields++; queueMicrotask(callback); return 0; }) as typeof window.setTimeout);
  try {
    const jars = await new AnsweredIndex(v.app).jars('Bank', 'Sittings', ['Pieces']);
    expect(jars.paragraphs).toHaveLength(1000);
    expect(yields).toBeGreaterThan(10);
  } finally { now.mockRestore(); timer.mockRestore(); }
});

test('concurrent callers with different folder scopes serialize without mixing results', async () => {
  let release!: () => void, started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let held = false;
  const v = fakeVault({ 'Pieces/a.md': 'I remember the moment clearly because everyone stopped talking when the door opened. ^a' }, { beforeRead: () => {
    if (held) return;
    held = true;
    return new Promise<void>(resolve => { release = resolve; started(); });
  } });
  const index = new AnsweredIndex(v.app);
  const writing = index.jars('Bank', 'Sittings', ['Pieces']);
  const excluded = index.jars('Bank', 'Sittings', []);
  await reading;
  release();
  expect((await writing).paragraphs.map(p => p.key)).toEqual(['Pieces/a.md#^a']);
  expect((await excluded).paragraphs).toEqual([]);
});

test('full invalidation during a pending read includes newly discovered notes', async () => {
  let release!: () => void, started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let held = false;
  const prose = 'I remember the moment clearly because everyone stopped talking when the door opened.';
  const v = fakeVault({ 'Pieces/a.md': `${prose} ^a` }, { beforeRead: () => {
    if (held) return;
    held = true;
    return new Promise<void>(resolve => { release = resolve; started(); });
  } });
  const index = new AnsweredIndex(v.app);
  const pending = index.jars('Bank', 'Sittings', ['Pieces']);
  await reading;
  await v.app.vault.create('Pieces/b.md', `${prose} another occasion ^b`);
  index.invalidate(); release();
  expect((await pending).paragraphs.map(p => p.key).sort()).toEqual(['Pieces/a.md#^a', 'Pieces/b.md#^b']);
});

test('a full invalidation at a yielded draw boundary never rebuilds answer ownership synchronously', async () => {
  const prose = 'I remember the moment clearly because everyone stopped talking when the door opened.';
  const v = fakeVault(Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`Pieces/${i}.md`, `${prose} ${i} ^p`])));
  const index = new AnsweredIndex(v.app);
  await index.jars('Bank', 'Sittings', ['Pieces']);
  let burst = 0, maxBurst = 0, clock = 0, invalidated = false;
  const original = v.app.metadataCache.getFileCache.bind(v.app.metadataCache);
  v.app.metadataCache.getFileCache = file => { burst++; return original(file); };
  const now = spyOn(performance, 'now').mockImplementation(() => ++clock);
  const timer = spyOn(window, 'setTimeout').mockImplementation(((callback: () => void) => {
    maxBurst = Math.max(maxBurst, burst); burst = 0;
    if (!invalidated) { invalidated = true; index.invalidate(); }
    queueMicrotask(callback); return 0;
  }) as typeof window.setTimeout);
  try {
    const { fillJars } = await import('../src/bank');
    const jars = await fillJars({ app: v.app, index, bankFolder: 'Bank', sittingsFolder: 'Sittings', writingFolders: ['Pieces'], skipped: new Set() }, null);
    maxBurst = Math.max(maxBurst, burst);
    expect(invalidated).toBe(true);
    expect(jars.paragraphs).toHaveLength(2000);
    expect(maxBurst).toBeLessThan(1500);
  } finally { now.mockRestore(); timer.mockRestore(); }
});

test('existing native list IDs survive marking and refuse a reassigned Ask without writes', async () => {
  const text = answer.replace('My original answer.', '- First answer item. ^native\n- Second answer item.');
  const v = fakeVault({ 'Sittings/day.md': text, 'Bank/q.md': '- What happened? ^q' });
  const file = v.file('Sittings/day.md');
  const marked = await markAnswered(v.app, file, parseAsks(text)[0], { bankFolder: 'Bank' });
  expect(marked).toEqual({ kind: 'ok', ref: { path: 'Sittings/day', blockId: 'native' } });
  expect(v.text(file.path)).toContain('- First answer item. ^native\n- Second answer item.');
  const stale = parseAsks(v.text(file.path))[0];
  await v.app.vault.process(file, data => data.replace('> from [[Bank/q#^q]]', '> from [[Bank/other#^q]]'));
  v.writes.length = 0;
  expect((await markAnswered(v.app, file, stale, { bankFolder: 'Bank' })).kind).toBe('refused');
  expect(v.writes).toHaveLength(0);
});
