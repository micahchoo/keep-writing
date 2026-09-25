// Graduation: a Thread leaves its Sitting and becomes a Piece. See CONTEXT.md,
// "Graduation".
//
// The owner's words move verbatim, block ids and all, so every answer keeps its
// address. Each Ask callout becomes a heading: the question, or one the owner
// chose. Those are the plugin's own lines, the one kind of body text it may
// write, and nothing the owner wrote is reworded. The Sitting stays as the
// day's record, minus what left it, and names the Pieces in `graduated`.
//
// Obsidian updates links when a FILE is renamed, never when text moves between
// notes. So every link to a moved block is retargeted here: in the Pieces, in
// what is left of the Sitting, and in any other note whose metadata names one.
//
// Writes run in the order that can be undone. The Pieces are made first, then
// the Sitting is rewritten inside `vault.process` only if it still reads as the
// owner saw it; if not, the new Pieces go to the trash and nothing else moved.

import { normalizePath } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { ANSWERS } from './links';
import { sittingName } from './paragraphs';
import { formatRef, parseRef } from './refs';
import { Refused } from './refusal';
import { threadSections } from './threads';
import type { Thread } from './threads';

/** The property on a Sitting that names the Pieces its words went to. */
export const GRADUATED = 'graduated';

export interface PieceChoice {
  thread: Thread;
  title: string;
  /** A Writing folder other than the Sittings folder. */
  folder: string;
  /** One per section, in order. A blank or missing one keeps the question. */
  headings?: string[];
}

const NO_TITLE = 'Give each Piece a title.';
const SAME_TITLE = 'Two Pieces cannot share a title in one folder.';
const CHANGED = 'The Sitting changed while you were choosing. Nothing was graduated; try again.';
const taken = (name: string, folder: string) => `A note called "${name}" is already in ${folder}. Choose another title.`;

/** What a file name cannot hold, on any system Obsidian runs on, or in a link. */
const NOT_IN_A_FILE_NAME = /[\\/:*?"<>|#^[\]]/g;

/** Pure: the file name a title is saved under. The title property keeps it whole. */
export function fileNameOf(title: string): string {
  return title.replace(NOT_IN_A_FILE_NAME, ' ').replace(/\s+/g, ' ').trim();
}

const BLOCK_LINK = /(\[\[)([^\]|#\n]+)(#\^)([A-Za-z0-9-]+)/g;
const BLOCK_ID = /\s\^([A-Za-z0-9-]+)\s*$/;

/**
 * Pure: every `[[path#^id]]` and `![[path#^id]]` whose path names the Sitting
 * and whose id moved, pointed at where the id went. Aliases, embeds and
 * frontmatter quotes survive because only the path is replaced.
 */
export function retarget(text: string, namesSitting: (linkPath: string) => boolean, moved: Map<string, string>): string {
  return text.replace(BLOCK_LINK, (whole, open: string, path: string, hash: string, id: string) => {
    const to = moved.get(id);
    return to && namesSitting(path.trim()) ? `${open}${to}${hash}${id}` : whole;
  });
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return typeof value === 'string' ? [value] : [];
}

/** Two ways of writing one ref, compared as the vault would. */
function sameRef(a: string, b: string): boolean {
  const ra = parseRef(a);
  const rb = parseRef(b);
  return !!ra && !!rb && formatRef(ra) === formatRef(rb);
}

interface Planned {
  choice: PieceChoice;
  title: string;
  path: string;
  /** The path as a link names it: no `.md`. */
  link: string;
  body: string;
  /** This thread's entries of the Sitting's `answers`, as written there. */
  answers: string[];
}

/**
 * Graduate one or more threads of a Sitting, read as `snapshot`. Returns the
 * Pieces made. Throws a Refusal, having written nothing, when a title is
 * missing or taken, or when the Sitting no longer reads as `snapshot`.
 */
export async function graduate(app: App, sitting: TFile, snapshot: string, choices: PieceChoice[]): Promise<TFile[]> {
  const lines = snapshot.split('\n');
  const answersNow = asList(app.metadataCache.getFileCache(sitting)?.frontmatter?.[ANSWERS]);
  const namesSittingFrom = (source: string) => (linkPath: string) =>
    app.metadataCache.getFirstLinkpathDest(linkPath, source)?.path === sitting.path;

  // Decide everything before writing anything.
  const planned: Planned[] = [];
  const moved = new Map<string, string>();
  for (const choice of choices) {
    const title = choice.title.trim();
    const name = fileNameOf(title);
    if (!name) throw new Refused(NO_TITLE);
    const path = normalizePath(`${choice.folder}/${name}.md`);
    if (planned.some((p) => p.path === path)) throw new Refused(SAME_TITLE);
    if (app.vault.getFileByPath(path)) throw new Refused(taken(name, choice.folder));
    const link = path.replace(/\.md$/, '');
    for (const ask of choice.thread.asks) {
      for (let l = ask.answer.start; l < ask.answer.end; l++) {
        const id = BLOCK_ID.exec(lines[l] ?? '')?.[1];
        if (id) moved.set(id, link);
      }
    }
    const sections = threadSections(snapshot, choice.thread);
    const body = sections
      .map((s, i) => `## ${choice.headings?.[i]?.replace(/\s+/g, ' ').trim() || s.question}\n\n${s.answer}\n`)
      .join('\n');
    const answers = answersNow.filter((entry) => choice.thread.asks.some((ask) => ask.sourceRef && sameRef(entry, ask.sourceRef)));
    planned.push({ choice, title, path, link, body, answers });
  }

  const leaving = new Set<number>();
  for (const { choice } of planned) {
    for (const ask of choice.thread.asks) for (let l = ask.callout.start; l < ask.answer.end; l++) leaving.add(l);
  }
  const namesSitting = namesSittingFrom(sitting.path);
  const remaining = retarget(lines.filter((_, i) => !leaving.has(i)).join('\n'), namesSitting, moved);
  const date = sittingName(sitting.basename).date;

  const made: TFile[] = [];
  try {
    for (const p of planned) {
      const file = await app.vault.create(p.path, retarget(p.body, namesSitting, moved));
      made.push(file);
      await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm['title'] = p.title;
        if (date) fm['date'] = date;
        if (p.answers.length) fm[ANSWERS] = p.answers.map((entry) => retarget(entry, namesSitting, moved));
      });
    }
    await app.vault.process(sitting, (data) => {
      if (data !== snapshot) throw new Refused(CHANGED);
      return remaining;
    });
  } catch (e) {
    for (const file of made) await app.fileManager.trashFile(file);
    throw e;
  }

  // The Sitting's own frontmatter was retargeted with the rest of it, so an
  // entry that left may now read either way.
  const gone = new Set(planned.flatMap((p) => p.answers.flatMap((entry) => [entry, retarget(entry, namesSitting, moved)])));
  await app.fileManager.processFrontMatter(sitting, (fm: Record<string, unknown>) => {
    const kept = asList(fm[ANSWERS]).filter((entry) => !gone.has(entry));
    if (kept.length) fm[ANSWERS] = kept;
    else delete fm[ANSWERS];
    fm[GRADUATED] = [...asList(fm[GRADUATED]), ...planned.map((p) => `[[${p.link}]]`)];
  });

  await relinkElsewhere(app, [sitting, ...made], moved, namesSittingFrom);
  return made;
}

/**
 * Every other note whose metadata links a moved block of the Sitting gets
 * that link retargeted. Only notes the metadata names are read, and only their
 * links change.
 */
async function relinkElsewhere(
  app: App,
  skip: TFile[],
  moved: Map<string, string>,
  namesSittingFrom: (source: string) => (linkPath: string) => boolean,
): Promise<void> {
  const skipped = new Set(skip.map((f) => f.path));
  for (const file of app.vault.getMarkdownFiles()) {
    if (skipped.has(file.path)) continue;
    const cache = app.metadataCache.getFileCache(file);
    const namesSitting = namesSittingFrom(file.path);
    const refs = [...(cache?.links ?? []), ...(cache?.embeds ?? []), ...(cache?.frontmatterLinks ?? [])];
    const touches = refs.some(({ link }) => {
      const [path = '', sub = ''] = link.split('#');
      return sub.startsWith('^') && moved.has(sub.slice(1)) && namesSitting(path);
    });
    if (touches) await app.vault.process(file, (text) => retarget(text, namesSitting, moved));
  }
}
