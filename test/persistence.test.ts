import { expect, test } from 'bun:test';
import KeepWritingPlugin from '../src/main';
function host(data: unknown, initial?: string, fail = false) {
  let secret = initial;
  const writes: unknown[] = [];
  const plugin = Object.create(KeepWritingPlugin.prototype) as KeepWritingPlugin;
  Object.assign(plugin, {
    app: { secretStorage: { getSecret: () => secret, setSecret: (_name: string, value: string) => { if (!fail) secret = value; } } },
    loadData: async () => data,
    saveData: async (value: unknown) => { writes.push(value); },
  });
  return { plugin, writes, secret: () => secret };
}
test('legacy token migrates before plaintext is removed, and a saved offer from 0.2.9 is dropped', async () => {
  const offer = { sitting: 'Sittings/day.md', ref: { path: 'Sittings/day', blockId: 'a' }, questions: ['What changed?'] };
  const h = host({ apiKey: 'synthetic-test-key', followUpOffer: offer });
  await h.plugin.loadSettings();
  expect(h.secret()).toBe('synthetic-test-key');
  expect(h.plugin.settings.apiKey).toBe('synthetic-test-key');
  expect(h.writes[0]).not.toHaveProperty('apiKey');
  expect(h.writes[0]).not.toHaveProperty('followUpOffer');
  await h.plugin.saveSettings();
  expect(h.writes.at(-1)).not.toHaveProperty('apiKey');
});
test('failed secret migration preserves existing data; an existing secret takes precedence', async () => {
  const failed = host({ apiKey: 'synthetic-test-key' }, undefined, true);
  await expect(failed.plugin.loadSettings()).rejects.toThrow('migration failed');
  expect(failed.writes).toEqual([]);
  const stored = host({ apiKey: 'old-test-key' }, 'new-test-key');
  await stored.plugin.loadSettings();
  expect(stored.plugin.settings.apiKey).toBe('new-test-key');
  expect(stored.writes[0]).not.toHaveProperty('apiKey');
});
// Follow-ups live in the modal that shows them, like every other offer. They
// were kept in plugin data until 2026-09-24 so a dismissed offer could be
// reopened; marking the answer again composes fresh ones, which is the way
// back that needs no stored state.
test('marking an answer shows its follow-ups at once and stores nothing', async () => {
  const { ChoiceModal } = await import('../src/modals');
  let shown: InstanceType<typeof ChoiceModal<string>> | undefined;
  const previous = ChoiceModal.prototype.open;
  ChoiceModal.prototype.open = function () { shown = this as InstanceType<typeof ChoiceModal<string>>; };
  try {
    const h = host({});
    await h.plugin.loadSettings();
    const sitting = { path: 'Sittings/day.md' };
    const ref = { path: 'Sittings/day', blockId: 'a' };
    const accepted: unknown[] = [];
    Object.assign(h.plugin, {
      model: { available: false },
      interview: {
        markAt: async () => ({ ref, questions: ['What changed?', 'What remained?'], error: null }),
        acceptFollowUp: async (file: unknown, question: string, from: unknown) => { accepted.push([file, question, from]); },
      },
    });
    const mark = (view: unknown, line: number) => (h.plugin as unknown as { markUnderCursor(v: unknown, l: number): Promise<void> }).markUnderCursor(view, line);
    await mark({ file: sitting }, 3);
    expect(shown?.getSuggestions('').map(row => row.value)).toEqual(['What changed?', 'What remained?']);
    shown!.onChooseSuggestion(shown!.getSuggestions('')[1]!);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(accepted).toEqual([[sitting, 'What remained?', ref]]);
    expect(h.writes).toEqual([]);
  } finally { ChoiceModal.prototype.open = previous; }
});

test('a stored folder list is read clean: a folder named twice is one folder', async () => {
  const h = host({ writingFolders: ['Pieces', 'Pieces/', ' '] });
  await h.plugin.loadSettings();
  expect(h.plugin.settings.writingFolders).toEqual(['Pieces']);
});
