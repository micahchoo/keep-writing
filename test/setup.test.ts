import { describe, expect, test } from 'bun:test';
import { applySetup, folderCandidates, setupDefaults } from '../src/setup';
import { DEFAULT_SETTINGS } from '../src/settings';
import { OLLAMA_URL } from '../src/endpoint';

// First run asked one thing — fill the question bank? — and left three to
// fail quietly: a second daily-note system beside the owner's own, an empty
// paragraph jar in front of years of writing, and a model that was not there.
// Setup detects each, proposes an answer, and writes nothing until confirmed.

const settings = { ...DEFAULT_SETTINGS };
const journal = { folder: 'Journal', format: 'YYYY-MM-DD', template: '' };
const counts = new Map([['Clippings', 9000], ['Notion', 39049], ['Notion/Deep', 12], ['Journal', 40], ['Bank', 3000], ['Empty', 0]]);
const here = { kind: 'found' as const, baseUrl: DEFAULT_SETTINGS.baseUrl, models: [DEFAULT_SETTINGS.model] };

describe('folderCandidates', () => {
  // Top-level folders only: a nested one is already inside its parent's count.
  test('top-level folders with writing in them, the most first, not the daily notes or the bank', () => {
    expect(folderCandidates(counts, 'Journal', 'Bank')).toEqual([
      { folder: 'Notion', paragraphs: 39049 },
      { folder: 'Clippings', paragraphs: 9000 },
    ]);
  });
});

describe('setupDefaults', () => {
  test('the daily notes folder is proposed, and read from', () => {
    const d = setupDefaults({ settings, daily: journal, probes: [here], banks: [] });
    expect(d.sittingsFolder).toBe('Journal');
    expect(d.writingFolders).toEqual(['Journal']);
  });
  test('without a daily notes folder, the one in settings stays', () => {
    expect(setupDefaults({ settings, daily: null, probes: [here], banks: [] }).sittingsFolder).toBe('Sittings');
  });
  test('every bank not already installed is proposed', () => {
    const d = setupDefaults({ settings, daily: null, probes: [here], banks: [{ name: 'a.md', exists: false }, { name: 'b.md', exists: true }] });
    expect(d.banks).toEqual(['a.md']);
  });
  test('the server in settings answers: AI on, as it is', () => {
    expect(setupDefaults({ settings, daily: null, probes: [here], banks: [] }).ai).toEqual({ enableModel: true, baseUrl: here.baseUrl, model: DEFAULT_SETTINGS.model });
  });
  test('it does not and Ollama does: AI on, at Ollama, with a model Ollama has', () => {
    const down = { kind: 'unreachable' as const, baseUrl: DEFAULT_SETTINGS.baseUrl, reason: 'refused' };
    const ollama = { kind: 'found' as const, baseUrl: OLLAMA_URL, models: ['llama3'] };
    expect(setupDefaults({ settings, daily: null, probes: [down, ollama], banks: [] }).ai).toEqual({ enableModel: true, baseUrl: OLLAMA_URL, model: 'llama3' });
  });
  // Off is the honest default when nothing answered: the bank still works,
  // and nothing fails the first time the owner marks an answer.
  test('nothing answers: AI off, address kept for later', () => {
    const down = { kind: 'unreachable' as const, baseUrl: DEFAULT_SETTINGS.baseUrl, reason: 'refused' };
    expect(setupDefaults({ settings, daily: null, probes: [down], banks: [] }).ai).toEqual({ enableModel: false, baseUrl: DEFAULT_SETTINGS.baseUrl, model: DEFAULT_SETTINGS.model });
  });
});

describe('applySetup', () => {
  test('writes the choices, adds ticked folders after the daily notes, and records that setup ran', () => {
    const next = applySetup(settings, {
      sittingsFolder: 'Journal',
      writingFolders: ['Journal', 'Notion'],
      banks: ['a.md'],
      ai: { enableModel: false, baseUrl: DEFAULT_SETTINGS.baseUrl, model: DEFAULT_SETTINGS.model },
    });
    expect(next).toMatchObject({ sittingsFolder: 'Journal', writingFolders: ['Journal', 'Notion'], enableModel: false, starterOffered: true });
    expect(settings.sittingsFolder).toBe('Sittings');
  });
});
