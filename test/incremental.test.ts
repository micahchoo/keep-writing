import { expect, test } from 'bun:test';
import { AnsweredIndex } from '../src/answered';
import { pickFromJars } from '../src/bank';
import { fakeVault } from './fake-vault';

test('draw index reads changed files only, retains other answer owners, and removes deleted rows', async () => {
  const reads: string[] = [];
  const v = fakeVault({
    'Pieces/a.md': 'A paragraph about a day I remember clearly. and more words to make this a full paragraph. ^a',
    'Pieces/b.md': 'Another paragraph about something I remember clearly. and more words to make this a full paragraph. ^b',
    'Sittings/one.md': '---\nanswers: "[[Pieces/a#^a]]"\n---',
    'Sittings/two.md': '---\nanswers: "[[Pieces/a#^a]]"\n---',
  }, { beforeRead: path => { reads.push(path); } });
  const index = new AnsweredIndex(v.app);
  await index.jars('Bank', 'Sittings', ['Pieces']);
  reads.length = 0;
  await index.jars('Bank', 'Sittings', ['Pieces']);
  expect(reads).toEqual([]);
  await v.app.vault.process(v.file('Pieces/b.md'), () => 'A revised paragraph about something I remember clearly. and more words to make this a full paragraph. ^b');
  index.invalidate(v.file('Pieces/b.md'));
  const jar = await index.jars('Bank', 'Sittings', ['Pieces']);
  expect(reads).toEqual(['Pieces/b.md']);
  expect(jar.paragraphs.some(p => p.text.includes('revised'))).toBe(true);
  expect(index.has('Pieces/a.md#^a')).toBe(true);
  index.remove('Sittings/one.md');
  expect(index.has('Pieces/a.md#^a')).toBe(true);
  index.remove('Sittings/two.md');
  expect(index.has('Pieces/a.md#^a')).toBe(false);
  index.remove('Pieces/b.md');
  expect((await index.jars('Bank', 'Sittings', ['Pieces'])).paragraphs.some(p => p.file.path === 'Pieces/b.md')).toBe(false);
});
test('disposal cannot repopulate a pending read', async () => {
  let release!: () => void;
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const v = fakeVault({ 'Pieces/a.md': 'Some words about a memory that matters. and more words to make this a full paragraph. ^a' }, { beforeRead: () => new Promise<void>(resolve => { release = resolve; started(); }) });
  const index = new AnsweredIndex(v.app);
  const pending = index.jars('Bank', 'Sittings', ['Pieces']);
  await reading;
  index.dispose(); release();
  expect((await pending).paragraphs).toEqual([]);
});
test('bank share endpoints select their jar and empty jars still fall back', async () => {
  const v = fakeVault({ 'Bank/a.md': '---\nkind: bank\n---\n- A question? ^q', 'Pieces/a.md': 'Some words about a memory that matters. and more words to make this a full paragraph. ^p' });
  const jars = await new AnsweredIndex(v.app).jars('Bank', 'Sittings', ['Pieces']);
  expect(pickFromJars(jars, () => .5, new Date(), 0)?.source.kind).toBe('paragraph');
  expect(pickFromJars(jars, () => .5, new Date(), 1)?.source.kind).toBe('question');
  expect(pickFromJars({ ...jars, bank: [] }, () => .5, new Date(), 1)?.source.kind).toBe('paragraph');
});
test('an edit during a read cannot publish stale paragraphs; folder changes rebuild the selection', async () => {
  let release!: () => void;
  let hold = true;
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const v = fakeVault({ 'Pieces/a.md': 'I wrote a long paragraph about the moment I understood what had happened. ^a' }, { beforeRead: () => { if (hold) { hold = false; return new Promise<void>(resolve => { release = resolve; started(); }); } } });
  const index = new AnsweredIndex(v.app);
  const pending = index.jars('Bank', 'Sittings', ['Pieces']);
  await reading;
  await v.app.vault.process(v.file('Pieces/a.md'), () => 'I revised this paragraph because I understood something new about what had happened. ^a');
  index.invalidate(v.file('Pieces/a.md')); release();
  expect((await pending).paragraphs[0]?.text).toContain('revised');
  expect((await index.jars('Bank', 'Sittings', [])).paragraphs).toEqual([]);
});
