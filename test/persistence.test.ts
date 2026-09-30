import { expect, test } from 'bun:test';
import KeepWritingPlugin from '../src/main';
import { LENS_VERSION, MAX_LENS_WORDS, REVISIT_WHERE } from '../src/lens';
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
// reopened; marking the answer again samples the model again, which is the
// way back that needs no stored state.
test('marking an answer shows its follow-ups at once and stores nothing', async () => {
  const { ChoiceModal } = await import('../src/modals');
  let shown: InstanceType<typeof ChoiceModal<string | null>> | undefined;
  const previous = ChoiceModal.prototype.open;
  ChoiceModal.prototype.open = function () { shown = this as InstanceType<typeof ChoiceModal<string | null>>; };
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
    // The last row asks again; null is its value.
    expect(shown?.getSuggestions('').map(row => row.value)).toEqual(['What changed?', 'What remained?', null]);
    shown!.onChooseSuggestion(shown!.getSuggestions('')[1]!);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(accepted).toEqual([[sitting, 'What remained?', ref]]);
    expect(h.writes).toEqual([]);
  } finally { ChoiceModal.prototype.open = previous; }
});

// "Different questions": the modal hands back everything it has shown, and
// asking twice excludes both rounds, not only the last.
test('asking for different follow-ups leaves out every question already shown', async () => {
  const { ChoiceModal } = await import('../src/modals');
  let shown: InstanceType<typeof ChoiceModal<string | null>> | undefined;
  const previous = ChoiceModal.prototype.open;
  ChoiceModal.prototype.open = function () { shown = this as InstanceType<typeof ChoiceModal<string | null>>; };
  try {
    const h = host({});
    await h.plugin.loadSettings();
    const excluded: string[][] = [];
    const rounds = [['What stayed?'], ['What moved?']];
    Object.assign(h.plugin, {
      model: { available: false },
      interview: {
        markAt: async () => ({ ref: { path: 'Sittings/day', blockId: 'a' }, questions: ['What changed?'], error: null }),
        moreFollowUps: async (_file: unknown, _answered: unknown, offered: string[]) => {
          excluded.push(offered);
          return { questions: rounds.shift() ?? [], error: null };
        },
      },
    });
    const mark = (view: unknown, line: number) => (h.plugin as unknown as { markUnderCursor(v: unknown, l: number): Promise<void> }).markUnderCursor(view, line);
    const askAgain = async () => {
      const rows = shown!.getSuggestions('');
      shown!.onChooseSuggestion(rows[rows.length - 1]!);
      await new Promise(resolve => setTimeout(resolve, 0));
    };
    await mark({ file: { path: 'Sittings/day.md' } }, 3);
    await askAgain();
    expect(shown?.getSuggestions('').map(row => row.value)).toEqual(['What stayed?', null]);
    await askAgain();
    expect(excluded).toEqual([['What changed?'], ['What changed?', 'What stayed?']]);
  } finally { ChoiceModal.prototype.open = previous; }
});

test('a stored folder list is read clean: a folder named twice is one folder', async () => {
  const h = host({ writingFolders: ['Pieces', 'Pieces/', ' '] });
  await h.plugin.loadSettings();
  expect(h.plugin.settings.writingFolders).toEqual(['Pieces']);
});

// `validate` guards the box; data.json can hold anything. A Lens the box
// would have refused is not used.
test('a stored Lens is read clean: over the limit or not text, the shipped one is used', async () => {
  const long = Array.from({ length: MAX_LENS_WORDS + 1 }, () => 'w').join(' ');
  const h = host({ craftLens: long, invitationLens: '  Ask about now.  ', lensVersion: LENS_VERSION });
  await h.plugin.loadSettings();
  expect(h.plugin.settings.craftLens).toBe('');
  expect(h.plugin.settings.invitationLens).toBe('Ask about now.');
});

// Before 2026-09-29 a Lens followed the where-to-look list; it holds the list
// now. An owner's old Lens keeps the list it was written after, and that is
// saved once, so the next load reads it as it is.
test('a Lens saved before the list moved into it is loaded with the list in front, and saved', async () => {
  const h = host({ craftLens: 'Ask about the tools.' });
  await h.plugin.loadSettings();
  expect(h.plugin.settings.craftLens).toBe(`${REVISIT_WHERE}\n\nAsk about the tools.`);
  expect(h.writes.at(-1)).toMatchObject({ craftLens: `${REVISIT_WHERE}\n\nAsk about the tools.`, lensVersion: LENS_VERSION });
});

test('bank weights survive saving and loading, including a paused custom bank', async () => {
  const h = host({ bankWeights: { 'ordinary-life.md': 60, 'garden.md': 0, 'broken.md': '25' } });
  await h.plugin.loadSettings();
  expect(h.plugin.settings.bankWeights).toEqual({ 'ordinary-life.md': 60, 'garden.md': 0 });
  await h.plugin.saveSettings();
  const reopened = host(h.writes.at(-1));
  await reopened.plugin.loadSettings();
  expect(reopened.plugin.settings.bankWeights).toEqual(h.plugin.settings.bankWeights);
});

test('older settings acquire the default mix without a settings write', async () => {
  const h = host({ bankShare: 0.25 });
  await h.plugin.loadSettings();
  expect(h.plugin.settings.bankWeights).toEqual({});
  expect(h.plugin.settings.bankShare).toBe(0.25);
  expect(h.writes).toEqual([]);
});

// A release that brings new questions says so once, on the first load of that
// version, and never again for it: the command stays for anyone who said no.
test('new questions are offered once per version, and only when installed banks lack some', async () => {
  const { OfferModal } = await import('../src/modals');
  const { STARTER_BANK } = await import('../src/starter-bank');
  const { fakeVault } = await import('./fake-vault');
  const shown: unknown[] = [];
  const previous = OfferModal.prototype.open;
  OfferModal.prototype.open = function () { shown.push(this); };
  try {
    const learning = STARTER_BANK.find((b) => b.name === 'learning.md')!;
    const lines = learning.markdown.trimEnd().split('\n');
    const v = fakeVault({ 'Bank/learning.md': `${lines.slice(0, -1).join('\n')}\n` });
    const h = host({});
    await h.plugin.loadSettings();
    Object.assign(h.plugin, { app: { ...v.app, secretStorage: h.plugin.app.secretStorage }, manifest: { version: '0.5.0' } });
    const offer = () => (h.plugin as unknown as { offerNewQuestions(): Promise<void> }).offerNewQuestions();

    await offer();
    expect(shown).toHaveLength(1);
    expect(h.plugin.settings.updateOfferedFor).toBe('0.5.0');
    await offer();
    expect(shown).toHaveLength(1);
  } finally { OfferModal.prototype.open = previous; }
});
