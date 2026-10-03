// The Doctor (CONTEXT.md): a command the owner presses, never one that runs by
// itself. It repairs what has one right answer and lists the rest. There is
// no undo, so a repair is made only where no other reading exists; anything
// with two readings is the owner's to decide.
//
// Every failure it looks for is SILENT: a question that stops existing with
// nothing said. A Bank line with no id is skipped by `loadBank`; one id on two
// lines of a note makes one answer retire both; an edited Custom question
// leaves its answer linked to an address that is gone.

import type { App, TFile } from 'obsidian';
import { asksOf } from './asks';
import { CUSTOM_BANK, bankNotes, isCustomBank, loadBank, parseBankLine } from './bank';
import { bankKey, bankWeight } from './bank-mix';
import type { BankWeights } from './bank-mix';
import { ANSWERS, answeredInVault } from './links';
import { formatRef, linksNamed, newBlockId, parseRef, resolveRef, virtualId, wikilink } from './refs';
import type { Ref } from './refs';

/** One thing left for the owner: where it is, what it says, and why it was not repaired. */
export interface Finding {
  path: string;
  /** 0-based line to open the note at. */
  line: number;
  text: string;
  why: string;
}

export interface Report {
  /** Ids added, by bank note path. */
  ids: Record<string, number>;
  /** `answers` links pointed at an edited Custom question. */
  retargeted: number;
  needs: Finding[];
}

/** A list line, once read: where it ends and the words it holds. */
interface Line {
  item: { id?: string; position: { start: { line: number }; end: { line: number } } };
  text: string;
}

/**
 * How many Bank lines no search or draw can see: list lines with no id in a
 * bank note other than Custom. Read off the metadata cache alone, so it is
 * cheap enough to ask every time Ask my own opens.
 */
export function skippedLines(app: App, bankFolder: string): number {
  let n = 0;
  for (const file of bankNotes(app, bankFolder)) {
    if (isCustomBank(file.path, bankFolder)) continue;
    n += (app.metadataCache.getFileCache(file)?.listItems ?? []).filter((i) => !i.id).length;
  }
  return n;
}

/** Find, repair what has one right answer, and report. */
export async function runDoctor(app: App, bankFolder: string, weights: BankWeights, random: () => number = Math.random): Promise<Report> {
  const report: Report = { ids: {}, retargeted: 0, needs: [] };
  const answered = answeredInVault(app);
  const notes = [...bankNotes(app, bankFolder)].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of notes) {
    if (bankWeight(bankKey(file.path, bankFolder), weights) <= 0) {
      report.needs.push({ path: file.path, line: 0, text: file.basename, why: 'This bank is paused at weight 0, so the draw never picks from it.' });
    }
    if (isCustomBank(file.path, bankFolder)) continue;
    await repairIds(app, file, answered, report, random);
  }
  await retargetCustom(app, bankFolder, report);
  return report;
}

/**
 * Give an id to each list line that has none, and a new id to each later line
 * that repeats an id earlier in the note. Both inside one `vault.process`,
 * checked against what was read, so a note edited meanwhile is left alone.
 */
async function repairIds(app: App, file: TFile, answered: Set<string>, report: Report, random: () => number): Promise<void> {
  const cache = app.metadataCache.getFileCache(file);
  const items = cache?.listItems ?? [];
  if (items.length === 0) return;
  const content = await app.vault.cachedRead(file);
  const lines = content.split('\n');
  const read = (item: Line['item']): Line => ({
    item,
    text: parseBankLine(lines.slice(item.position.start.line, item.position.end.line + 1).join(' ')).text,
  });
  const shipped = cache?.frontmatter?.['shipped'] !== undefined;
  const give: Line[] = [];

  for (const line of items.filter((i) => !i.id).map(read)) {
    if (!line.text) continue;
    if (answered.has(`${file.path}#^${virtualId(line.text)}`)) {
      report.needs.push({ path: file.path, line: line.item.position.start.line, text: line.text, why: 'This line has an answer but no id. If this note was the Custom bank, rename it back to Custom.' });
    } else give.push(line);
  }

  const seen = new Map<string, Line[]>();
  for (const line of items.filter((i) => i.id).map(read)) {
    const id = line.item.id as string;
    seen.set(id, [...(seen.get(id) ?? []), line]);
  }
  for (const [id, same] of seen) {
    if (same.length < 2) continue;
    const [first] = same;
    if (shipped || answered.has(`${file.path}#^${id}`)) {
      const why = shipped
        ? `^${id} is on ${same.length} lines of a Starter Bank note, whose ids other vaults hold. Remove the copy you added.`
        : `^${id} is on ${same.length} lines and has an answer, which cannot say which line it meant. Give the others a new id.`;
      report.needs.push({ path: file.path, line: first?.item.position.start.line ?? 0, text: first?.text ?? '', why });
    } else give.push(...same.slice(1));
  }
  if (give.length === 0) return;

  const taken = new Set<string>();
  for (const item of items) if (item.id) taken.add(item.id);
  const fresh = (): string => {
    const id = newBlockId(cache, random, taken);
    taken.add(id);
    return id;
  };
  let written = false;
  await app.vault.process(file, (data) => {
    if (data !== content) return data;
    const out = data.split('\n');
    for (const { item } of give) {
      const end = item.position.end.line;
      const last = out[end] ?? '';
      const cr = last.endsWith('\r') ? '\r' : '';
      const bare = stripId(cr ? last.slice(0, -1) : last);
      out[end] = `${bare} ^${fresh()}${cr}`;
    }
    written = true;
    return out.join('\n');
  });
  if (written) report.ids[file.path] = give.length;
  else report.needs.push({ path: file.path, line: 0, text: file.basename, why: 'This note changed while it was being checked. Run the Doctor again.' });
}

/** A line without its trailing ` ^id`, when it has one. */
function stripId(line: string): string {
  return line.replace(/\s+\^[A-Za-z0-9-]+\s*$/, '').trimEnd();
}

/**
 * Each `answers` link to a Custom question that no longer exists is pointed at
 * the line clearly closest to the words it was asked with — the Ask in the
 * answering note still holds them. Only the property is written; the Sitting
 * body never is.
 */
async function retargetCustom(app: App, bankFolder: string, report: Report): Promise<void> {
  const customPath = `${bankFolder.replace(/\/+$/, '')}/${CUSTOM_BANK}.md`;
  const customFile = app.vault.getFileByPath(customPath);
  const questions = customFile ? await loadBank(app, customFile, bankFolder) : [];
  const live = new Set(questions.map((q) => q.ref.blockId));

  for (const file of app.vault.getMarkdownFiles()) {
    for (const fl of linksNamed(app.metadataCache.getFileCache(file), ANSWERS)) {
      const ref = parseRef(fl.link);
      if (!ref?.blockId || !ref.blockId.startsWith('kw-') || live.has(ref.blockId)) continue;
      if (!pointsAtCustom(app, ref, file.path, customPath)) continue;
      const asked = (await asksOf(app, file)).find((a) => parseRef(a.sourceRef)?.blockId === ref.blockId)?.question;
      const to = asked ? closest(asked, questions.map((q) => ({ text: q.text, ref: q.ref }))) : null;
      if (!customFile || !to) {
        const why = !customFile
          ? `This answer's question was in ${customPath}, which is gone. If you renamed it, rename it back to Custom.`
          : 'This answer\'s question was edited, and no one line of the Custom bank is clearly what it became.';
        report.needs.push({ path: file.path, line: 0, text: asked ?? formatRef(ref), why });
        continue;
      }
      await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        const list = Array.isArray(fm[ANSWERS]) ? (fm[ANSWERS] as unknown[]) : [fm[ANSWERS]];
        fm[ANSWERS] = list.map((v) => (typeof v === 'string' && parseRef(v)?.blockId === ref.blockId ? wikilink(to) : v));
      });
      report.retargeted++;
    }
  }
}

/** Resolved, the link's note; gone, the path the link still names. */
function pointsAtCustom(app: App, ref: Ref, from: string, customPath: string): boolean {
  const resolved = resolveRef(app, ref, from);
  return resolved ? resolved.file.path === customPath : `${ref.path}.md` === customPath;
}

/** The share of words two questions hold in common, out of all the words either holds. */
function overlap(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);
  const wa = words(a);
  const wb = words(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  const union = wa.size + wb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Clearly closest: at least half its words shared, and well ahead of the next best. */
const CLOSE = 0.5;
const AHEAD = 0.2;

function closest(asked: string, lines: { text: string; ref: Ref }[]): Ref | null {
  const scored = lines.map((l) => ({ ref: l.ref, score: overlap(asked, l.text) })).sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (!best || best.score < CLOSE) return null;
  if (next && best.score - next.score < AHEAD) return null;
  return best.ref;
}

/** The one Notice a run ends with. */
export function doctorLine(report: Report): string {
  const parts: string[] = [];
  for (const [path, n] of Object.entries(report.ids)) {
    const name = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
    parts.push(`Added ${n} id${n === 1 ? '' : 's'} in ${name}.`);
  }
  if (report.retargeted) parts.push(`Pointed ${report.retargeted} answer${report.retargeted === 1 ? '' : 's'} at its edited question.`);
  if (report.needs.length) parts.push(`${report.needs.length} thing${report.needs.length === 1 ? ' needs' : 's need'} you.`);
  return parts.length ? parts.join(' ') : 'The question banks are in order.';
}

