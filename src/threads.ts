// A Thread: one root Ask and every Follow-up that grew from it. See CONTEXT.md,
// "Thread".
//
// The `from` line already says which Ask belongs to which: a Follow-up cites an
// answer block in the same Sitting, and anything else — a Bank draw, the Seed,
// a Revisit, a Selection, the Pick-up — starts a new thread. So a thread is
// read off the note, never judged. The model is not asked which answers belong
// together; that is a relation, and CONTEXT.md records why a small model is not
// trusted with one.
//
// Pure: markdown in, threads out. The caller says which link paths name this
// Sitting and which sources are the Bookmark, because both need the vault.

import { parseAsks } from './asks';
import type { Ask } from './asks';
import { parseRef } from './refs';

export interface Thread {
  /** The root first, then its Follow-ups, in the order the note holds them. */
  asks: Ask[];
}

/** A block id at the end of a line: ` ^a1b2c3`. */
const BLOCK_ID = /\s\^([A-Za-z0-9-]+)\s*$/;

/**
 * The threads of a Sitting, in the order their roots appear.
 *
 * A thread whose root has no answer is left out: there is nothing to graduate.
 * So is a root `leaveOut` names — the Bookmark, whose answer is where to pick
 * up tomorrow and belongs to no piece.
 */
export function threadsOf(
  markdown: string,
  isHere: (linkPath: string) => boolean,
  leaveOut: (sourceRef: string) => boolean = () => false,
): Thread[] {
  const lines = markdown.split('\n');
  const asks = parseAsks(markdown);
  // Which Ask's answer holds each block id.
  const holder = new Map<string, number>();
  asks.forEach((ask, i) => {
    for (let l = ask.answer.start; l < ask.answer.end; l++) {
      const id = BLOCK_ID.exec(lines[l] ?? '')?.[1];
      if (id) holder.set(id, i);
    }
  });
  const rootOf = (i: number, seen = new Set<number>()): number => {
    const ref = parseRef(asks[i]?.sourceRef ?? '');
    const parent = ref?.blockId && isHere(ref.path) ? holder.get(ref.blockId) : undefined;
    if (parent === undefined || parent === i || seen.has(parent)) return i;
    seen.add(i);
    return rootOf(parent, seen);
  };
  const byRoot = new Map<number, Ask[]>();
  asks.forEach((ask, i) => {
    const root = rootOf(i);
    byRoot.set(root, [...(byRoot.get(root) ?? []), ask]);
  });
  return [...byRoot.entries()]
    .filter(([root]) => asks[root]?.firstParagraph && !leaveOut(asks[root]?.sourceRef ?? ''))
    .map(([, members]) => ({ asks: members }));
}

/** One section of a thread: the question, and what the owner wrote under it, verbatim. */
export interface Section {
  question: string;
  answer: string;
}

/** Pure: a thread's sections, blank lines trimmed from each end of an answer and nothing else. */
export function threadSections(markdown: string, thread: Thread): Section[] {
  const lines = markdown.split('\n');
  return thread.asks.map((ask) => ({
    question: ask.question,
    answer: lines.slice(ask.answer.start, ask.answer.end).join('\n').replace(/^\s*\n/, '').trimEnd(),
  }));
}
