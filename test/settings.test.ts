// The pure halves of the settings tab. `readFolders` decides whether the
// owner's corpus is reachable at all: hand the draw a trailing slash and it
// reaches nothing, silently, because `inFolders` compares `path + '/'`.
//
// Folders are chosen from dropdowns since 2026-09-24, so nothing can be typed
// wrong any more. What is stored can still be: by an older version's
// textarea, or by hand in data.json. It is cleaned when it is read.

import { describe, expect, test } from 'bun:test';
import { TFile, TFolder } from 'obsidian';
import { folderOptions, keepFoldersFresh, isEndpoint, readFolders, withFolder, withoutFolder } from '../src/settings';

describe('readFolders', () => {
  test('a stored list, as it is', () => {
    expect(readFolders(['Sittings', 'Pieces'])).toEqual(['Sittings', 'Pieces']);
  });

  test('blank entries and whitespace are not folders', () => {
    expect(readFolders(['Sittings', '', '  ', '  Pieces  '])).toEqual(['Sittings', 'Pieces']);
  });

  test('slashes are stripped at both ends, kept in the middle', () => {
    expect(readFolders(['/Sittings/', 'writing/pieces/'])).toEqual(['Sittings', 'writing/pieces']);
  });

  test('the same folder twice is one folder', () => {
    expect(readFolders(['Pieces', '/Pieces', 'Pieces/'])).toEqual(['Pieces']);
  });

  test('anything that is not a list of names is no folders', () => {
    expect(readFolders(undefined)).toEqual([]);
    expect(readFolders('Pieces')).toEqual([]);
    expect(readFolders([3, null])).toEqual([]);
  });
});

describe('the folder dropdowns', () => {
  test('every folder in the vault, sorted, root left out', () => {
    expect(Object.keys(folderOptions(['Sittings', '/', 'Bank', 'Pieces/2021'], []))).toEqual(['Bank', 'Pieces/2021', 'Sittings']);
  });

  // The Bank folder does not exist until the starter bank is written, and a
  // dropdown that cannot show the current value shows a wrong one.
  test('a folder the setting names is offered even before it exists', () => {
    expect(Object.keys(folderOptions(['Sittings'], ['Bank', 'Sittings']))).toEqual(['Bank', 'Sittings']);
  });

  test('adding a folder already in the list changes nothing; removing takes it out', () => {
    expect(withFolder(['Sittings'], 'Pieces')).toEqual(['Sittings', 'Pieces']);
    expect(withFolder(['Sittings', 'Pieces'], 'Pieces')).toEqual(['Sittings', 'Pieces']);
    expect(withoutFolder(['Sittings', 'Pieces'], 'Sittings')).toEqual(['Pieces']);
  });
});

describe('isEndpoint', () => {
  test('a URL the request can be made against', () => {
    expect(isEndpoint('http://127.0.0.1:8088/v1')).toBe(true);
    expect(isEndpoint('https://api.example.com/v1')).toBe(true);
    expect(isEndpoint('  http://localhost:1234/v1  ')).toBe(true);
  });

  test('anything the request cannot be made against', () => {
    expect(isEndpoint('')).toBe(false);
    expect(isEndpoint('127.0.0.1:8088')).toBe(false); // no scheme at all
    expect(isEndpoint('file:///etc/passwd')).toBe(false); // parses, but not something to POST to
    expect(isEndpoint('not a url')).toBe(false);
  });
});

// Obsidian reads getSettingDefinitions() when the tab is ADDED — at plugin
// load, before the vault is indexed — and draws that copy on every open; a
// display() override is bypassed in 1.13. So the folder dropdowns offered
// nothing but their current value after every restart, measured 2026-09-24
// in a running 1.13.7: one option, three after update().
describe('the folder options stay fresh', () => {
  function wire() {
    const handlers: Record<string, (f: unknown) => void> = {};
    let ready: (() => void) | null = null;
    const app = {
      workspace: { onLayoutReady: (f: () => void) => { ready = f; } },
      vault: { on: (name: string, f: (x: unknown) => void) => { handlers[name] = f; return name; } },
    };
    let updates = 0;
    const registered: unknown[] = [];
    keepFoldersFresh(app as never, { update: () => { updates++; } }, (ref) => registered.push(ref));
    return { handlers, ready: () => ready?.(), updates: () => updates, registered };
  }

  test('once the vault is indexed, the definitions are read again', () => {
    const w = wire();
    expect(w.updates()).toBe(0);
    w.ready();
    expect(w.updates()).toBe(1);
  });

  test('a folder made, removed or renamed is read again; a note is not', () => {
    const w = wire();
    w.ready();
    for (const event of ['create', 'delete', 'rename']) w.handlers[event]!(new TFolder());
    w.handlers['create']!(new TFile());
    expect(w.updates()).toBe(4);
    expect(w.registered).toEqual(['create', 'delete', 'rename']);
  });
});

// The percentage shown in settings must not change the persisted 0–1 scale.
test('the saved-question percentage is bound to the existing share setting', async () => {
  const { KeepWritingSettingTab, DEFAULT_SETTINGS } = await import('../src/settings');
  const tab = Object.create(KeepWritingSettingTab.prototype) as InstanceType<typeof KeepWritingSettingTab>;
  const host = { settings: { ...DEFAULT_SETTINGS, bankShare: 0.7 }, saveSettings: async () => {} };
  Object.assign(tab, { host });
  expect(tab.getControlValue('bankShare')).toBe(70);
  await tab.setControlValue('bankShare', 25);
  expect(host.settings.bankShare).toBe(0.25);
  await tab.setControlValue('bankShare', 0);
  expect(host.settings.bankShare).toBe(0);
  await tab.setControlValue('bankShare', 100);
  expect(host.settings.bankShare).toBe(1);
});

// The box shows the Lens in use, so the owner edits the real text and not a
// blank. Only their own text is stored: a box left at the shipped Lens, or
// cleared, stores '' and follows the shipped Lens when a release improves it.
describe('the Lens boxes', () => {
  const tabWith = async (settings: Record<string, unknown> = {}) => {
    const { KeepWritingSettingTab, DEFAULT_SETTINGS } = await import('../src/settings');
    const tab = Object.create(KeepWritingSettingTab.prototype) as InstanceType<typeof KeepWritingSettingTab>;
    const host = { settings: { ...DEFAULT_SETTINGS, ...settings }, saveSettings: async () => {} };
    Object.assign(tab, { host });
    return { tab, host };
  };

  test('an empty setting shows the shipped Lens', async () => {
    const { CRAFT_LENS, INVITATION_LENS } = await import('../src/lens');
    const { tab } = await tabWith();
    expect(tab.getControlValue('craftLens')).toBe(CRAFT_LENS);
    expect(tab.getControlValue('invitationLens')).toBe(INVITATION_LENS);
  });

  test('the owner’s text is stored; the shipped text or an empty box stores nothing', async () => {
    const { CRAFT_LENS } = await import('../src/lens');
    const { tab, host } = await tabWith();
    await tab.setControlValue('craftLens', '  Ask about the tools.  ');
    expect(host.settings.craftLens).toBe('Ask about the tools.');
    await tab.setControlValue('craftLens', CRAFT_LENS);
    expect(host.settings.craftLens).toBe('');
    await tab.setControlValue('craftLens', 'Mine again.');
    await tab.setControlValue('craftLens', '   ');
    expect(host.settings.craftLens).toBe('');
  });

  // `validate` stops the box first; this is the second lock, for any caller.
  test('a Lens over the limit is refused and the last one stays', async () => {
    const { MAX_LENS_WORDS } = await import('../src/lens');
    const { tab, host } = await tabWith({ invitationLens: 'Ask about now.' });
    await tab.setControlValue('invitationLens', Array.from({ length: MAX_LENS_WORDS + 1 }, () => 'w').join(' '));
    expect(host.settings.invitationLens).toBe('Ask about now.');
  });
});

test('imported banks appear after indexing without scanning on unrelated note edits', async () => {
  const { keepBanksFresh, DEFAULT_SETTINGS } = await import('../src/settings');
  const { fakeVault } = await import('./fake-vault');
  const v = fakeVault({ 'Journal/day.md': 'A day.' });
  const handlers: Record<string, (...args: never[]) => void> = {};
  let ready = () => {};
  let updates = 0;
  let scans = 0;
  const getFiles = v.app.vault.getMarkdownFiles;
  Object.assign(v.app.vault, {
    getMarkdownFiles: () => { scans++; return getFiles(); },
    on: (name: string, handler: (...args: never[]) => void) => { handlers[`vault:${name}`] = handler; return name; },
  });
  Object.assign(v.app.metadataCache, {
    on: (name: string, handler: (...args: never[]) => void) => { handlers[`cache:${name}`] = handler; return name; },
  });
  Object.assign(v.app, { workspace: { onLayoutReady: (handler: () => void) => { ready = handler; } } });
  const host = { settings: { ...DEFAULT_SETTINGS, bankWeights: {} }, saveSettings: async () => {} };
  keepBanksFresh(v.app, host as never, { update: () => updates++ }, () => {});
  ready();
  const initialScans = scans;
  handlers['cache:changed']!(v.file('Journal/day.md') as never);
  handlers['vault:rename']!(v.file('Journal/day.md') as never, 'Journal/old.md' as never);
  expect(scans).toBe(initialScans);
  const imported = await v.app.vault.create('Bank/Garden.md', '---\nkind: bank\n---\n\n- what grew here? #register/episode ^garden-001\n');
  handlers['cache:changed']!(imported as never);
  expect(updates).toBe(1);
  handlers['cache:changed']!(imported as never);
  expect(updates).toBe(1);
  await v.app.vault.process(imported, () => 'An ordinary note now.');
  handlers['cache:changed']!(imported as never);
  expect(updates).toBe(2);
});

test('renaming a bank preserves its paused setting', async () => {
  const { keepBanksFresh, DEFAULT_SETTINGS } = await import('../src/settings');
  const { fakeVault } = await import('./fake-vault');
  const v = fakeVault({ 'Bank/New name.md': '---\nkind: bank\n---\n' });
  const handlers: Record<string, (...args: never[]) => void> = {};
  Object.assign(v.app.vault, { on: (name: string, handler: (...args: never[]) => void) => { handlers[name] = handler; return name; } });
  Object.assign(v.app.metadataCache, { on: () => 'changed' });
  Object.assign(v.app, { workspace: { onLayoutReady: () => {} } });
  let saves = 0;
  const weights: Record<string, number> = { 'Old name.md': 0 };
  const host = { settings: { ...DEFAULT_SETTINGS, bankWeights: weights }, saveSettings: async () => { saves++; } };
  keepBanksFresh(v.app, host as never, { update: () => {} }, () => {});
  handlers.rename!(v.file('Bank/New name.md') as never, 'Bank/Old name.md' as never);
  expect(host.settings.bankWeights).toEqual({ 'New name.md': 0 });
  expect(saves).toBe(1);
});
