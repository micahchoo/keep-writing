// Asks in a Sitting: `> [!ask] question` callouts, their source line, and the
// answer text that follows. The callout is the one thing this plugin parses
// by hand; every regex for it lives here.
//
// This module does not read the Bank, at any remove. What a Bank entry is FOR
// — its Role, and the Closing move that follows from it — is closing.ts's to
// know, and the Interview's to run. `markAnswered` called `runClosing` until
// 2026-09-17, so a callout parser still pulled in the Bank, the Target and the
// paragraph jar; moving the Closing out of this module had only made the
// import one hop longer.
//
// It does not speak to the owner either. `markAnswered` used to show its own
// Notices, so its two callers could see THAT it refused and never why, and a
// callout parser imported `obsidian` at runtime to say three sentences. The
// reason is data now; the Interview's Surface says it.

import type { App, TFile } from 'obsidian';
import { ensureBlockId } from './blocks';
import { answeredKeys, linkAnswer } from './links';
import { refusalLine } from './refusal';
import { formatRef, keyOfRef, parseRef } from './refs';
import type { Ref } from './refs';

const ASK_TITLE = /^>\s*\[!ask\][+-]?\s*(.*?)\s*$/i;
// The from-line starts with the word `from`; an embed line (`> ![[...]]`)
// does not, so it is swallowed into the callout without being read as a source.
// Only the link is read: Sittings are append-only, and an old from-line may
// still carry the `about [[...]]` clause of the slotted design.
const FROM_LINE = /^>\s*from\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/i;
const DUE_LINE = /^>\s*due:\s*(\d{4}-\d{2}-\d{2})\s*$/i;
const HEADING = /^#{1,6}\s/;
const ASKED_HEADING = /^#{1,6}\s+Asked\s*$/;

export interface LineRange {
  /** First line, 0-based. */
  start: number;
  /** Last line, 0-based, inclusive. */
  end: number;
}

export interface Ask {
  question: string;
  /** Source ref as written inside the brackets, e.g. `Bank/craft#^b1`. Empty if malformed. */
  sourceRef: string;
  due?: string;
  callout: LineRange;
  /** Answer lines: from the callout's end to the next Ask, heading or EOF. `end` is exclusive. */
  answer: { start: number; end: number };
  /** First non-blank run of lines in the answer, or null if the answer is empty. */
  firstParagraph: LineRange | null;
  answered: boolean;
}

/**
 * Parse a Sitting's markdown into Asks. `isAnswered` says whether a source
 * ref already has an `answers` link from this note (the caller reads the
 * note's frontmatter; this function reads only the body).
 */
export function parseAsks(
  markdown: string,
  isAnswered: (sourceRef: string) => boolean = () => false,
): Ask[] {
  const lines = markdown.split('\n');
  const asks: Ask[] = [];
  let i = 0;
  while (i < lines.length) {
    const title = ASK_TITLE.exec(lines[i] ?? '');
    if (!title) {
      i++;
      continue;
    }
    const start = i;
    let end = i;
    while (end + 1 < lines.length && (lines[end + 1] ?? '').startsWith('>')) end++;

    let sourceRef = '';
    let due: string | undefined;
    for (let j = start + 1; j <= end; j++) {
      const line = lines[j] ?? '';
      const from = FROM_LINE.exec(line);
      if (from && !sourceRef) sourceRef = (from[1] ?? '').trim();
      const d = DUE_LINE.exec(line);
      if (d) due = d[1];
    }

    let answerEnd = end + 1;
    while (answerEnd < lines.length) {
      const line = lines[answerEnd] ?? '';
      if (ASK_TITLE.test(line) || HEADING.test(line)) break;
      answerEnd++;
    }

    const ask: Ask = {
      question: title[1] ?? '',
      sourceRef,
      callout: { start, end },
      answer: { start: end + 1, end: answerEnd },
      firstParagraph: firstParagraph(lines, end + 1, answerEnd),
      answered: sourceRef ? isAnswered(sourceRef) : false,
    };
    if (due) ask.due = due;
    asks.push(ask);
    i = answerEnd;
  }
  return asks;
}

function firstParagraph(lines: string[], from: number, to: number): LineRange | null {
  let s = from;
  while (s < to && (lines[s] ?? '').trim() === '') s++;
  if (s >= to) return null;
  let e = s;
  while (e + 1 < to && (lines[e + 1] ?? '').trim() !== '') e++;
  return { start: s, end: e };
}

/**
 * Pure: the whole answer under an Ask, as the person wrote it, with block ids
 * stripped. This is what the model reads; the block id marks only the first
 * paragraph, as the link anchor.
 */
export function answerText(markdown: string, ask: Ask): string {
  return markdown
    .split('\n')
    .slice(ask.answer.start, ask.answer.end)
    .map((l) => l.replace(/\s+\^[A-Za-z0-9-]+\s*$/, ''))
    .join('\n')
    .trim();
}

/**
 * Pure: every question already put to the owner about one block of a Sitting.
 * Two ways an Ask is about a block: the block sits in its answer, or the Ask
 * was composed from the block and cites it as its source. `isSource` tells
 * the second apart, because comparing refs needs the vault to resolve them.
 *
 * This is the `asked` set a Revisit is measured against. A Sitting block is
 * almost always the first paragraph of an answer, so it always has at least
 * one question hanging on it, and without this the draw could hand that
 * question straight back days later.
 */
export function questionsAbout(
  asks: Ask[],
  line: number,
  isSource: (sourceRef: string) => boolean,
): string[] {
  return asks
    .filter((a) => (line >= a.answer.start && line < a.answer.end) || (!!a.sourceRef && isSource(a.sourceRef)))
    .map((a) => a.question);
}

/**
 * Asks of a Sitting, with answered-ness read from THIS note's own `answers`
 * property.
 *
 * That is narrower than the canon — "a source is answered when any block
 * carries an `answers` link to it", which is what `bank.ts#AnsweredIndex`
 * reads — and it is deliberate. An answer to an Ask lands in the Sitting that
 * holds the Ask, so the two readings agree; widening this one would mean a
 * vault scan on every keystroke in a Sitting, for a case that cannot arise.
 * Do not "fix" it into the index.
 */
export async function asksOf(app: App, file: TFile): Promise<Ask[]> {
  const content = await app.vault.cachedRead(file);
  const answered = new Set(answeredKeys(app, file));
  return parseAsks(content, (src) => {
    const ref = parseRef(src);
    const key = ref && keyOfRef(app, ref, file.path);
    return !!key && answered.has(key);
  });
}

export interface AskOptions {
  /** Absolute due date, written as a `due:` line. */
  due?: string;
  /** Embed the source block under the from-line (`> ![[source]]`), so a Revisit reads in place. */
  embed?: boolean;
}

/**
 * Pure: append an Ask callout at the end of the `## Asked` section (creating
 * the heading if missing) followed by one blank line and an empty line for
 * the cursor. Returns the new text and the cursor line.
 */
export function appendAsk(
  markdown: string,
  question: string,
  sourceRef: string,
  opts: AskOptions = {},
): { text: string; cursorLine: number } {
  const { due, embed } = opts;
  const lines = markdown.split('\n');
  let heading = lines.findIndex((l) => ASKED_HEADING.test(l));
  if (heading < 0) {
    while (lines.length && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push('## Asked');
    heading = lines.length - 1;
  }
  let sectionEnd = heading + 1;
  while (sectionEnd < lines.length && !HEADING.test(lines[sectionEnd] ?? '')) sectionEnd++;
  let insertAt = sectionEnd;
  while (insertAt > heading + 1 && (lines[insertAt - 1] ?? '').trim() === '') insertAt--;

  const block = ['', `> [!ask] ${question.trim()}`, `> from [[${sourceRef}]]`];
  if (embed) block.push(`> ![[${sourceRef}]]`);
  if (due) block.push(`> due: ${due}`);
  block.push('', '');
  lines.splice(insertAt, sectionEnd - insertAt, ...block);
  return { text: lines.join('\n'), cursorLine: insertAt + block.length - 1 };
}

/** Write an Ask into a Sitting. Returns the line where the answer should start. */
export async function insertAsk(
  app: App,
  file: TFile,
  question: string,
  sourceRef: Ref,
  opts: AskOptions = {},
): Promise<number> {
  let cursorLine = 0;
  await app.vault.process(file, (data) => {
    const r = appendAsk(data, question, formatRef(sourceRef), opts);
    cursorLine = r.cursorLine;
    return r.text;
  });
  return cursorLine;
}

export interface MarkOptions {
  bankFolder: string;
}

/**
 * What marking did: the answer block's ref, or the one line to tell the owner
 * why it refused. Every refusal writes nothing at all.
 */
export type Marked = { kind: 'ok'; ref: Ref } | { kind: 'refused'; reason: string };

/**
 * Mark an Ask's answer done: give its first paragraph a block id and link it
 * `answers` -> source. Whatever Closing move the source calls for runs after
 * this, in the Interview (closing.ts#runClosing), beside the other thing that
 * happens once an answer is linked.
 */
export async function markAnswered(app: App, file: TFile, ask: Ask, opts: MarkOptions): Promise<Marked> {
  if (!ask.firstParagraph) return { kind: 'refused', reason: 'No answer under this Ask yet.' };
  const source = parseRef(ask.sourceRef);
  if (!source) return { kind: 'refused', reason: 'This Ask has no source link; it is malformed.' };
  let ref: Ref;
  try {
    ref = await ensureBlockId(app, file, ask.firstParagraph.start);
  } catch (e) {
    return { kind: 'refused', reason: refusalLine(e) };
  }
  await linkAnswer(app, ref, source, opts);
  return { kind: 'ok', ref };
}
