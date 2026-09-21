import { expect, test } from 'bun:test';
import KeepWritingPlugin from '../src/main';
import { readOffer } from '../src/saved-offer';
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
test('legacy token migrates before plaintext is removed, and recovered offers survive settings writes', async () => {
  const offer = { sitting: 'Sittings/day.md', ref: { path: 'Sittings/day', blockId: 'a' }, questions: ['What changed?'] };
  const h = host({ apiKey: 'synthetic-test-key', followUpOffer: offer });
  await h.plugin.loadSettings();
  expect(h.secret()).toBe('synthetic-test-key');
  expect(h.plugin.settings.apiKey).toBe('synthetic-test-key');
  expect(h.writes[0]).not.toHaveProperty('apiKey');
  expect(h.writes[0]).toHaveProperty('followUpOffer', offer);
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
test('saved offers validate reference and question types at the storage boundary', () => {
  expect(readOffer({ sitting: 'x', ref: { path: 'x' }, questions: ['Question?'] })).toBeNull();
  expect(readOffer({ sitting: 'x', ref: { path: 'x', blockId: 'a' }, questions: [42] })).toBeNull();
  const offer = { sitting: 'x', ref: { path: 'x', blockId: 'a' }, questions: ['Question?'] };
  expect(readOffer(JSON.parse(JSON.stringify(offer)))).toEqual(offer);
});

test('dismissed offers reopen after reload without a model call, and accepted questions leave the saved offer', async () => {
  const { ChoiceModal } = await import('../src/modals');
  const offer = { sitting: 'Sittings/day.md', ref: { path: 'Sittings/day', blockId: 'a' }, questions: ['What changed?', 'What remained?'] };
  let shown: InstanceType<typeof ChoiceModal<string>> | undefined;
  const previous = ChoiceModal.prototype.open;
  ChoiceModal.prototype.open = function () { shown = this as InstanceType<typeof ChoiceModal<string>>; };
  try {
    const h = host({ followUpOffer: offer });
    await h.plugin.loadSettings();
    const app = h.plugin.app;
    Object.assign(app, { vault: { getFileByPath: () => ({ path: offer.sitting }) }, metadataCache: { getFirstLinkpathDest: () => ({ path: offer.sitting }), getFileCache: () => ({ blocks: { a: {} } }) } });
    const accepted: string[] = [];
    Object.assign(h.plugin, { interview: { acceptFollowUp: async (_file: unknown, question: string) => { accepted.push(question); } } });
    const reopen = () => (h.plugin as unknown as { reopenFollowUps(): void }).reopenFollowUps();
    reopen(); // Dismiss: no selection callback.
    expect(shown?.getSuggestions('').map(row => row.value)).toEqual(offer.questions);
    reopen();
    shown!.onChooseSuggestion(shown!.getSuggestions('')[0]!);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(accepted).toEqual(['What changed?']);
    expect(h.writes.at(-1)).toHaveProperty('followUpOffer.questions', ['What remained?']);
  } finally { ChoiceModal.prototype.open = previous; }
});
