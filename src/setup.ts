// First-run setup: what it proposes, and what confirming it writes.
//
// First run asked one thing until 2026-09-30 — fill the question bank? — and
// left three things to fail quietly: a second daily-note system beside the
// owner's own, an empty paragraph jar in front of years of their writing, and
// a model that was not there, met first as an error. Setup detects each,
// proposes an answer, and writes nothing until the owner confirms.
//
// Pure: the modal (setup-modal.ts) gathers the facts and draws the choices.

import type { DailyNotes } from './daily';
import { dailyAdvice } from './daily';
import { serverAdvice } from './endpoint';
import type { Probe } from './endpoint';
import type { KeepWritingSettings } from './settings';

/** What setup reads before it proposes anything. */
export interface SetupFacts {
  settings: KeepWritingSettings;
  daily: DailyNotes | null;
  /** `endpoint.ts#findServers`'s answers. */
  probes: Probe[];
  /** Each shipped bank, and whether the vault already holds it. */
  banks: { name: string; exists: boolean }[];
}

/** What the owner confirms. */
export interface SetupChoices {
  sittingsFolder: string;
  writingFolders: string[];
  /** Shipped bank notes to install. */
  banks: string[];
  ai: { enableModel: boolean; baseUrl: string; model: string };
}

/** Past this many, the list is a wall; the settings picker holds the rest. */
const MAX_CANDIDATES = 8;

/**
 * Pure: top-level folders with writing in them, the most first, leaving out
 * the daily notes and the bank. Top level only: a nested folder is already
 * inside its parent's count. Offered, never ticked: a vault's biggest folder
 * is often clippings or an import of someone else's words.
 */
export function folderCandidates(counts: Map<string, number>, sittingsFolder: string, bankFolder: string): { folder: string; paragraphs: number }[] {
  return [...counts]
    .filter(([f, n]) => n > 0 && !f.includes('/') && f !== sittingsFolder && f !== bankFolder)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, MAX_CANDIDATES)
    .map(([folder, paragraphs]) => ({ folder, paragraphs }));
}

/** Pure: what setup proposes, from what it found. */
export function setupDefaults(facts: SetupFacts): SetupChoices {
  const { settings } = facts;
  const daily = dailyAdvice(facts.daily, settings.sittingsFolder);
  const sittingsFolder = daily.kind === 'offer' ? daily.folder : settings.sittingsFolder;
  const writingFolders = settings.writingFolders.map((f) => (f === settings.sittingsFolder ? sittingsFolder : f));
  const banks = facts.banks.filter((b) => !b.exists).map((b) => b.name);
  const server = serverAdvice(facts.probes, settings.baseUrl, settings.model);
  const keep = { baseUrl: settings.baseUrl, model: settings.model };
  // Off when nothing answered: the bank still works, and nothing fails the
  // first time the owner marks an answer. The address is kept for later.
  const ai = server.models
    ? { enableModel: true, ...keep }
    : server.other
      ? { enableModel: true, baseUrl: server.other.baseUrl, model: server.other.models.includes(settings.model) ? settings.model : server.other.models[0] ?? settings.model }
      : { enableModel: false, ...keep };
  return { sittingsFolder, writingFolders, banks, ai };
}

/** Pure: the settings once the owner confirms. `starterOffered` records that setup ran. */
export function applySetup(settings: KeepWritingSettings, choices: SetupChoices): KeepWritingSettings {
  return {
    ...settings,
    sittingsFolder: choices.sittingsFolder,
    writingFolders: [...new Set(choices.writingFolders)],
    ...choices.ai,
    starterOffered: true,
  };
}
