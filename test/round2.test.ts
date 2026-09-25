import { describe, expect, test, spyOn } from 'bun:test';
import { markAnswered, parseAsks } from '../src/asks';
import KeepWritingPlugin from '../src/main';
import { ChoiceModal } from '../src/modals';
import { selectionParagraph } from '../src/selection';
import { fakeVault } from './fake-vault';

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
      expect((await markAnswered(v.app, file, ask)).kind).toBe('refused');
      expect(v.writes).toHaveLength(0);
      expect(v.text(file.path)).toBe(changed);
    });
  }

  test('relocates an unchanged Ask and answer, preserving surrounding text', async () => {
    const v = fakeVault({ 'Sittings/day.md': answer, 'Bank/q.md': '- What happened? ^q' });
    const file = v.file('Sittings/day.md');
    const ask = parseAsks(answer)[0];
    await v.app.vault.process(file, () => `Unrelated preface.\n\n${answer}`);
    expect((await markAnswered(v.app, file, ask)).kind).toBe('ok');
    expect(v.text(file.path)).toContain('Unrelated preface.\n\n> [!ask]');
    expect(v.text(file.path)).toMatch(/My original answer\. \^[a-z0-9]{6}/);
  });

  test('list answers retain their first-item anchor and subsequent authored items', async () => {
    const text = answer.replace('My original answer.', '- First answer item.\n- Second answer item.');
    const v = fakeVault({ 'Sittings/day.md': text, 'Bank/q.md': '- What happened? ^q' });
    const result = await markAnswered(v.app, v.file('Sittings/day.md'), parseAsks(text)[0]);
    expect(result.kind).toBe('ok');
    expect(v.text('Sittings/day.md')).toMatch(/- First answer item\. \^[a-z0-9]{6}\n- Second answer item\./);
  });
});

test('an offer finishing after unload opens no chooser', async () => {
  const v = fakeVault({ 'x.md': 'A deliberately selected paragraph.\n', 'Sittings/day.md': '## Asked\n' });
  const source = selectionParagraph(v.app, v.file('x.md'), 'A deliberately selected paragraph.', 0, 'Sittings');
  let release!: (value: { candidates: { question: string }[]; lens: null; error: null }) => void;
  const plugin = Object.create(KeepWritingPlugin.prototype) as KeepWritingPlugin;
  Object.assign(plugin, { app: v.app, unloaded: false, model: { available: false }, interview: { offerFrom: () => new Promise(resolve => { release = resolve; }) } });
  const show = spyOn(ChoiceModal.prototype, 'open').mockImplementation(() => {});
  try {
    const pending = (plugin as unknown as { offer(...args: unknown[]): Promise<void> }).offer(v.file('Sittings/day.md'), source, 'pointed');
    (plugin as unknown as { unloaded: boolean }).unloaded = true; release({ candidates: [{ question: 'What changed?' }], lens: null, error: null });
    await pending;
    expect(show).not.toHaveBeenCalled();
    expect(v.writes).toHaveLength(0);
  } finally { show.mockRestore(); }
});

test('existing native list IDs survive marking and refuse a reassigned Ask without writes', async () => {
  const text = answer.replace('My original answer.', '- First answer item. ^native\n- Second answer item.');
  const v = fakeVault({ 'Sittings/day.md': text, 'Bank/q.md': '- What happened? ^q' });
  const file = v.file('Sittings/day.md');
  const marked = await markAnswered(v.app, file, parseAsks(text)[0]);
  expect(marked).toEqual({ kind: 'ok', ref: { path: 'Sittings/day', blockId: 'native' } });
  expect(v.text(file.path)).toContain('- First answer item. ^native\n- Second answer item.');
  const stale = parseAsks(v.text(file.path))[0];
  await v.app.vault.process(file, data => data.replace('> from [[Bank/q#^q]]', '> from [[Bank/other#^q]]'));
  v.writes.length = 0;
  expect((await markAnswered(v.app, file, stale)).kind).toBe('refused');
  expect(v.writes).toHaveLength(0);
});
