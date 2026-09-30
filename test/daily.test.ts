import { describe, expect, test } from 'bun:test';
import { dailyAdvice, dailyNotesOf, sharesDailyFolder } from '../src/daily';
import type { App } from 'obsidian';

// Nothing read Obsidian's Daily notes plugin until 2026-09-29. Someone who
// keeps a journal in `Journal/` got a second daily note in `Sittings/`, and
// the opening question went into the one they do not use.

const appWith = (plugin: unknown) => ({ internalPlugins: { getPluginById: (id: string) => (id === 'daily-notes' ? plugin : null) } }) as unknown as App;

describe('dailyNotesOf', () => {
  test('reads the core plugin when it is on, with its defaults filled in', () => {
    expect(dailyNotesOf(appWith({ enabled: true, instance: { options: { folder: 'Journal/', format: 'DD-MM-YYYY', template: 'T/Day' } } })))
      .toEqual({ folder: 'Journal', format: 'DD-MM-YYYY', template: 'T/Day' });
    expect(dailyNotesOf(appWith({ enabled: true, instance: { options: {} } }))).toEqual({ folder: '', format: 'YYYY-MM-DD', template: '' });
  });
  test('off, missing, or not shaped as expected is no daily notes at all', () => {
    expect(dailyNotesOf(appWith({ enabled: false, instance: { options: { folder: 'Journal' } } }))).toBeNull();
    expect(dailyNotesOf(appWith(null))).toBeNull();
    expect(dailyNotesOf({} as App)).toBeNull();
  });
});

describe('dailyAdvice', () => {
  const journal = { folder: 'Journal', format: 'YYYY-MM-DD', template: '' };
  test('another folder is offered', () => {
    expect(dailyAdvice(journal, 'Sittings')).toEqual({ kind: 'offer', folder: 'Journal' });
  });
  test('the same folder needs nothing', () => {
    expect(dailyAdvice(journal, 'Journal')).toEqual({ kind: 'same' });
  });
  // A Sitting is a note in the Sittings folder; the top level would make every
  // loose note in the vault one.
  test('daily notes at the top level cannot be shared, and that is said', () => {
    expect(dailyAdvice({ ...journal, folder: '' }, 'Sittings')).toEqual({ kind: 'top-level' });
  });
  test('no daily notes plugin, nothing to say', () => {
    expect(dailyAdvice(null, 'Sittings')).toEqual({ kind: 'none' });
  });
});

describe('sharesDailyFolder', () => {
  test('only when the daily notes plugin is on and writes into the Sittings folder', () => {
    expect(sharesDailyFolder({ folder: 'Journal', format: 'YYYY-MM-DD', template: '' }, 'Journal')).toBe(true);
    expect(sharesDailyFolder({ folder: 'Journal', format: 'YYYY-MM-DD', template: '' }, 'Sittings')).toBe(false);
    expect(sharesDailyFolder(null, 'Journal')).toBe(false);
  });
});
