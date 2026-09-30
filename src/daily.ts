// Obsidian's own Daily notes plugin, read so keep-writing can share its folder.
//
// Nothing read it until 2026-09-29. Someone who keeps a journal in `Journal/`
// got a second daily note in `Sittings/`, and the opening question went into
// the one they do not use.
//
// The core plugin is not in the published API: `app.internalPlugins` and its
// `options` are read by duck-typing, and anything unexpected reads as "no
// daily notes", which is what the plugin assumed before. Today's note is made
// by the core plugin's own command (main.ts#openSitting), so its date format
// and template are the owner's and nothing here formats a date.

import type { App } from 'obsidian';

export interface DailyNotes {
  /** Without slashes; '' is the vault's top level. */
  folder: string;
  format: string;
  template: string;
}

/**
 * The core plugin's default format, which is what an empty `options` means —
 * and the one keep-writing names its own Sittings by (interview.ts#dayStamp).
 */
export const DAY_FORMAT = 'YYYY-MM-DD';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The core Daily notes plugin's settings, when it is on. */
export function dailyNotesOf(app: App): DailyNotes | null {
  const plugins = (app as { internalPlugins?: { getPluginById?: (id: string) => unknown } }).internalPlugins;
  const plugin = plugins?.getPluginById?.('daily-notes') as { enabled?: unknown; instance?: { options?: unknown } } | null | undefined;
  if (plugin?.enabled !== true) return null;
  const options = plugin.instance?.options;
  if (!options || typeof options !== 'object') return null;
  const o = options as Record<string, unknown>;
  return {
    folder: str(o['folder']).replace(/^\/+|\/+$/g, ''),
    format: str(o['format']) || DAY_FORMAT,
    template: str(o['template']),
  };
}

export type DailyAdvice =
  | { kind: 'none' }
  | { kind: 'same' }
  | { kind: 'offer'; folder: string }
  | { kind: 'top-level' };

/**
 * Pure: what settings says about the daily notes folder. A folder is offered,
 * never switched to: it changes where questions land. The top level is not
 * offered: a Sitting is a note in the Sittings folder, and there every loose
 * note in the vault would be one.
 */
export function dailyAdvice(daily: DailyNotes | null, sittingsFolder: string): DailyAdvice {
  if (!daily) return { kind: 'none' };
  if (!daily.folder) return { kind: 'top-level' };
  if (daily.folder === sittingsFolder) return { kind: 'same' };
  return { kind: 'offer', folder: daily.folder };
}

/** Does the core plugin write today's note into the Sittings folder? Then it makes it. */
export function sharesDailyFolder(daily: DailyNotes | null, sittingsFolder: string): boolean {
  return !!daily && !!daily.folder && daily.folder === sittingsFolder;
}
