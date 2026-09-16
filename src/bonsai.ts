// bonsai-27b client. Three jobs: compose a Follow-up, compose a Revisit
// (the same job, with the Well's Lens appended), propose a Relation.
//
// Contract (CONTEXT.md, "Bonsai judges, code arbitrates"): one job per call,
// small payload, temperature 0, JSON out, every quote checked in code as an
// exact substring, one retry with the rejection attached, then drop.
// Abstain is always a legal answer.
//
// No import from "obsidian". The caller injects a fetch-like function so the
// plugin can pass requestUrl and a script can pass global fetch.

export type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text: string }>;

export interface CallLog {
  job: 'follow-up' | 'revisit' | 'relation';
  attempt: number;
  ms: number;
  outcome: 'ok' | 'abstain' | 'invalid' | 'error';
  reason?: string;
}

export interface BonsaiConfig {
  baseUrl: string;
  model: string;
  fetcher: Fetcher;
  timeoutMs?: number;
  onLog?: (entry: CallLog) => void;
}

export type Relation = 'echoes' | 'contradicts' | 'follows';
const RELATIONS: readonly Relation[] = ['echoes', 'contradicts', 'follows'];

export interface Candidate {
  ref: string;
  text: string;
}

export interface Proposal {
  ref: string;
  relation: Relation;
  quote: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 256;
const MIN_QUOTE_WORDS = 3;

// Phrases that refer to the conversation itself. A follow-up must read as a
// fresh question, not as a reply.
const SELF_REFERENCE = [
  'you said',
  'you mentioned',
  'you wrote',
  'you described',
  'earlier you',
  'as you mentioned',
  'as you said',
  'in your answer',
  'your answer',
  'you told me',
  'you just',
];

// ---------------------------------------------------------------------------
// Transport

type Rejected = { output: string; reason: string };

type Verdict<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'abstain' }
  | { kind: 'invalid'; reason: string };

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

async function chat(cfg: BonsaiConfig, messages: Message[]): Promise<string> {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = JSON.stringify({
    model: cfg.model,
    temperature: 0,
    max_tokens: MAX_TOKENS,
    messages,
  });
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const res = await Promise.race([
      cfg.fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
      timeout,
    ]);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    }
    const parsed = JSON.parse(res.text) as { choices?: { message?: { content?: string } }[] };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('no message content in response');
    return content;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Defensive JSON

/** Strip code fences, then return the first balanced {...} object, or null. */
export function extractJson(raw: string): unknown {
  const text = raw.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '');
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function isAbstain(obj: unknown): boolean {
  return typeof obj === 'object' && obj !== null && (obj as { abstain?: unknown }).abstain === true;
}

const QUOTE_MARKS = /["'\u201c\u201d\u2018\u2019]/;

/**
 * Find `quote` in `text` and return the text's own verbatim span, or null.
 * Exact match first. Failing that, any quotation mark in the model's quote
 * may stand for any quotation mark in the text: bonsai swaps a phrase's inner
 * double quotes for single quotes when it writes JSON (measured 2026-09-13)
 * and repeats the swap on retry. Nothing else is normalized: case, spacing
 * and dropped words still fail.
 */
export function locateQuote(quote: string, text: string): string | null {
  if (text.includes(quote)) return quote;
  if (!QUOTE_MARKS.test(quote)) return null;
  const pattern = quote
    .split('')
    .map((c) => (QUOTE_MARKS.test(c) ? QUOTE_MARKS.source : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  const m = new RegExp(pattern).exec(text);
  return m ? m[0] : null;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Generic job runner: call, check, retry once with the rejection attached.

/**
 * How a job ended. `abstain` is the model declining, which is a legal answer
 * and must not be worked around; `failed` is transport trouble or output the
 * checks rejected twice, which a caller may answer with a second arm.
 */
type JobResult<T> = { kind: 'ok'; value: T } | { kind: 'abstain' } | { kind: 'failed' };

function valueOrNull<T>(r: JobResult<T>): T | null {
  return r.kind === 'ok' ? r.value : null;
}

async function runJob<T>(
  cfg: BonsaiConfig,
  job: CallLog['job'],
  system: string,
  user: string,
  check: (obj: unknown) => Verdict<T>,
): Promise<JobResult<T>> {
  let rejected: Rejected | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    // The retry is a real exchange: the model's rejected turn, then the
    // reason. Measured 2026-09-13: at temperature 0 bonsai repeated a
    // quote-mark swap under both this shape and a correction appended to the
    // user message; locateQuote now absorbs that case. Whether the retry
    // recovers a case change or a dropped word is untested live.
    const messages: Message[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    if (rejected) {
      messages.push({ role: 'assistant', content: rejected.output });
      messages.push({
        role: 'user',
        content: `Rejected: ${rejected.reason}.\nAnswer again, differently, or reply {"abstain": true}.`,
      });
    }

    const started = Date.now();
    let raw: string;
    try {
      raw = await chat(cfg, messages);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      cfg.onLog?.({ job, attempt, ms: Date.now() - started, outcome: 'error', reason });
      return { kind: 'failed' };
    }
    const ms = Date.now() - started;

    const obj = extractJson(raw);
    if (obj === null) {
      rejected = { output: raw.trim().slice(0, 400), reason: 'no JSON object found in output' };
      cfg.onLog?.({ job, attempt, ms, outcome: 'invalid', reason: rejected.reason });
      continue;
    }
    if (isAbstain(obj)) {
      cfg.onLog?.({ job, attempt, ms, outcome: 'abstain' });
      return { kind: 'abstain' };
    }
    const verdict = check(obj);
    if (verdict.kind === 'ok') {
      cfg.onLog?.({ job, attempt, ms, outcome: 'ok' });
      return { kind: 'ok', value: verdict.value };
    }
    if (verdict.kind === 'abstain') {
      cfg.onLog?.({ job, attempt, ms, outcome: 'abstain' });
      return { kind: 'abstain' };
    }
    rejected = { output: JSON.stringify(obj).slice(0, 400), reason: verdict.reason };
    cfg.onLog?.({ job, attempt, ms, outcome: 'invalid', reason: verdict.reason });
  }
  return { kind: 'failed' };
}

// ---------------------------------------------------------------------------
// Follow-up

const MAX_FOLLOW_UPS = 3;
const MAX_FOLLOW_UP_WORDS = 30;

export const FOLLOW_UP_SYSTEM = `You are an autoethnographic interviewer. A person is being interviewed so that their own words become the material for their writing. You are shown the question they were asked and the answer they wrote. Compose the next question.

Reply with a JSON object and nothing else:
{"questions": ["...", "...", "..."]}

Give up to three candidate questions, best first. Each one:
- is a single question, ending with "?", in plain words, under 25 words;
- asks for something only this person can answer and that you cannot guess from the answer;
- reaches for something concrete: a specific time this happened, a real example, a choice they made, a contrast between two things they named, or a consequence they have not stated;
- may use their own terms, but never hands their answer back to them as a question;
- is never the question they were just asked, in any wording. They have answered it. An answer that names three things where the question asked for one is still an answer;
- does not refer to the conversation ("you said", "earlier", "your answer").
Do not explain. Do not praise the answer.

Where to look for the question, in order of preference:
1. A term they coined or use oddly: ask what it means to them, with an example.
2. A thing they named but did not open: ask about it.
3. An abstraction with no scene under it: ask for the moment it comes from.
4. A pole with no contrast: ask what the opposite would be.
5. A cause claimed with no event: ask what happened.
6. A trailing thought, a "might", a tag, an aside: ask what is behind it.`;

/**
 * Pure: keep the candidates that pass the code checks, in the model's order.
 * A candidate fails when it is not a question, parrots the answer, re-asks
 * `asked`, refers to the conversation, or runs long. The whole output is
 * invalid only when no candidate survives.
 *
 * `asked` is the question the answer answers; empty for a Revisit, which has
 * no asked question, only a paragraph. Measured 2026-09-13 on the Sitting
 * "Not ready for?": asked "What is one specific area…" and answered with
 * three, bonsai returned that same question three times over, at temperature
 * 0, in prose and in list form alike. It reads the question as still open
 * and re-issues it. Nothing else in the checks caught it, so the pane offered
 * the owner the question they had just answered, and accepting it would have
 * written the same Ask again.
 */
export function checkFollowUps(obj: unknown, answer: string, asked = ''): Verdict<string[]> {
  if (typeof obj !== 'object' || obj === null) return { kind: 'invalid', reason: 'output is not an object' };
  const raw = (obj as { questions?: unknown }).questions;
  if (!Array.isArray(raw)) return { kind: 'invalid', reason: 'missing "questions" array' };
  const seen = new Set<string>();
  const kept: string[] = [];
  const reasons: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const q = item.trim();
    const key = normalize(q);
    if (!q || seen.has(key)) continue;
    seen.add(key);
    if (!q.endsWith('?')) { reasons.push(`"${q}" does not end with "?"`); continue; }
    if (wordCount(q) > MAX_FOLLOW_UP_WORDS) { reasons.push(`"${q}" is longer than ${MAX_FOLLOW_UP_WORDS} words`); continue; }
    if (isParrot(q, answer)) { reasons.push(`"${q}" repeats the answer back`); continue; }
    if (asked && isParrot(q, asked)) { reasons.push(`"${q}" re-asks the question that was just answered`); continue; }
    const lower = q.toLowerCase();
    const hit = SELF_REFERENCE.find((p) => lower.includes(p));
    if (hit) { reasons.push(`"${q}" refers to the conversation ("${hit}")`); continue; }
    kept.push(q);
    if (kept.length === MAX_FOLLOW_UPS) break;
  }
  if (kept.length === 0) return { kind: 'invalid', reason: reasons.join('; ') || 'no usable question' };
  return { kind: 'ok', value: kept };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A parrot is the answer handed back with a question mark. Two tests:
 * the normalized question equals the normalized answer, or the question is a
 * long run of words that all already sit in the answer (six or more content
 * words, every one of them present).
 */
export function isParrot(question: string, answer: string): boolean {
  const nq = normalize(question);
  const na = normalize(answer);
  if (nq === na) return true;
  if (nq.length > 20 && na.includes(nq)) return true;

  const answerWords = new Set(na.split(' '));
  const questionWords = nq.split(' ').filter((w) => w.length >= 4);
  if (questionWords.length < 6) return false;
  return questionWords.every((w) => answerWords.has(w));
}

/**
 * Compose up to three follow-up questions from the question that was asked
 * and the whole answer, best first. No quote is required: the model gets the
 * answer as context and its freedom; code keeps only what reads as a fresh
 * question. Empty on abstain, transport error, or when both arms fail.
 *
 * Two arms, because the question asked is not always safe to show. Measured
 * 2026-09-13 against bonsai-27b at temperature 0, on the Sitting "Not ready
 * for?": asked "What is one specific area…", answered with three areas, the
 * model returned that same question three times over. It does this in prose
 * and in list form alike; it does it again under the retry with the rejection
 * attached; and it does it again when the user message says outright that
 * they named three and to ask about one. The question line is what provokes
 * it — the model reads its terms as unmet and re-issues it. Given the same
 * answer with no question line, the same model asks about what was written.
 * So the second arm drops the question and keeps the answer. The re-ask check
 * runs on both arms.
 */
export async function composeFollowUps(cfg: BonsaiConfig, question: string, answer: string, target: string): Promise<string[]> {
  const about = target === 'me' ? '' : `About: ${target}\n\n`;
  const check = (obj: unknown) => checkFollowUps(obj, answer, question);
  const asked = `${about}Question asked: ${question}\n\nAnswer:\n${answer}`;
  const first = await runJob(cfg, 'follow-up', FOLLOW_UP_SYSTEM, asked, check);
  if (first.kind === 'ok') return first.value;
  // An abstain is the model saying it has nothing to ask. That is a legal
  // answer and the second arm must not go around it.
  if (first.kind === 'abstain') return [];
  const answerOnly = `${about}Answer:\n${answer}`;
  return valueOrNull(await runJob(cfg, 'follow-up', FOLLOW_UP_SYSTEM, answerOnly, check)) ?? [];
}

// ---------------------------------------------------------------------------
// Revisit

/** A question composed for a Revisit, and the return date the Lens may ask for. */
export interface RevisitCandidate {
  question: string;
  /** Days from today, when the question ended with `(due +Nd)`. */
  dueDays?: number;
}

const DUE_MARKER = /\s*\(\s*due\s*\+(\d+)\s*d\s*\)\s*(\?)?\s*$/i;

/**
 * Pure: split a trailing `(due +Nd)` marker off a question. The learning
 * Lens asks bonsai to end an expedition question with it; the marker is not
 * part of the question the owner reads. A `?` after the marker is kept as
 * the question's own.
 */
export function splitDue(raw: string): RevisitCandidate {
  const m = DUE_MARKER.exec(raw);
  if (!m) return { question: raw.trim() };
  let question = raw.slice(0, m.index).trim();
  if (m[2] && !question.endsWith('?')) question += '?';
  return { question, dueDays: Number(m[1]) };
}

/**
 * Pure: the Follow-up checks, applied to Revisit output. Each candidate is
 * split off its due marker first, so the marker never fails the `?` test
 * and never reaches the owner; a kept question gets its `dueDays` back.
 */
export function checkRevisit(obj: unknown, paragraph: string): Verdict<RevisitCandidate[]> {
  if (typeof obj !== 'object' || obj === null) return { kind: 'invalid', reason: 'output is not an object' };
  const raw = (obj as { questions?: unknown }).questions;
  if (!Array.isArray(raw)) return { kind: 'invalid', reason: 'missing "questions" array' };
  const split = raw.filter((q): q is string => typeof q === 'string').map(splitDue);
  const verdict = checkFollowUps({ questions: split.map((c) => c.question) }, paragraph);
  if (verdict.kind !== 'ok') return verdict;
  const value = verdict.value.map((question) => {
    const days = split.find((c) => c.question === question)?.dueDays;
    return days === undefined ? { question } : { question, dueDays: days };
  });
  return { kind: 'ok', value };
}

/**
 * Compose up to three questions from a paragraph the person wrote before,
 * best first. Same interviewer, same checks as a Follow-up: the paragraph is
 * the context, the framing says when and where it was written (`in 2021,
 * for Branch Magazine`), and the Well's Lens, when it has one, is appended
 * to the system prompt verbatim. Empty on abstain, transport error, or when
 * the retry also fails.
 */
export async function composeRevisit(cfg: BonsaiConfig, paragraph: string, framing: string, lens = ''): Promise<RevisitCandidate[]> {
  const system = lens.trim() ? `${FOLLOW_UP_SYSTEM}\n\n${lens.trim()}` : FOLLOW_UP_SYSTEM;
  const user = `Something they wrote ${framing}:\n\n${paragraph}`;
  return valueOrNull(await runJob(cfg, 'revisit', system, user, (obj) => checkRevisit(obj, paragraph))) ?? [];
}

// ---------------------------------------------------------------------------
// Relation

const RELATION_SYSTEM = `You compare a fresh answer against a few earlier blocks the same person wrote. Pick at most ONE block and name the relation between the answer and that block.

Reply with a JSON object and nothing else. Two shapes are allowed:
{"ref": "...", "relation": "...", "quote": "..."}
{"abstain": true}

Relations:
- echoes: the block says the same thing as the answer again in different words.
- contradicts: the block and the answer both claim the present and cannot both be true.
- follows: the answer continues or builds on the block.

Rules:
- "ref" is copied from the block's ref line.
- "quote" is a phrase copied from that block's text, at least 3 words, character for character: same letters, same case, same punctuation. It must show the relation.
- Only pick a block when the relation is clear. If nothing fits, or the overlap is only shared words, reply {"abstain": true}. Abstain is the correct answer when in doubt.`;

export function checkProposal(obj: unknown, candidates: Candidate[]): Verdict<Proposal> {
  if (typeof obj !== 'object' || obj === null) return { kind: 'invalid', reason: 'output is not an object' };
  const { ref, relation, quote } = obj as { ref?: unknown; relation?: unknown; quote?: unknown };
  if (typeof ref !== 'string') return { kind: 'invalid', reason: 'missing "ref"' };
  if (typeof relation !== 'string') return { kind: 'invalid', reason: 'missing "relation"' };
  if (typeof quote !== 'string' || quote.trim() === '') return { kind: 'invalid', reason: 'missing "quote"' };

  const refTrimmed = ref.trim();
  const candidate = candidates.find((c) => c.ref === refTrimmed);
  if (!candidate) {
    return { kind: 'invalid', reason: `ref "${refTrimmed}" is not one of the candidate refs` };
  }
  const rel = relation.trim().toLowerCase();
  if (!(RELATIONS as readonly string[]).includes(rel)) {
    return { kind: 'invalid', reason: `relation "${relation}" is not one of ${RELATIONS.join(', ')}` };
  }
  const quoteTrimmed = locateQuote(quote.trim(), candidate.text);
  if (quoteTrimmed === null) {
    return { kind: 'invalid', reason: `quote "${quote.trim()}" is not an exact substring of block ${refTrimmed} (case-sensitive)` };
  }
  if (wordCount(quoteTrimmed) < MIN_QUOTE_WORDS) {
    return { kind: 'invalid', reason: `quote has fewer than ${MIN_QUOTE_WORDS} words` };
  }
  return { kind: 'ok', value: { ref: refTrimmed, relation: rel as Relation, quote: quoteTrimmed } };
}

/**
 * Given a fresh answer and up to 5 candidate blocks, pick at most one
 * candidate and a relation, with a quote from that candidate's text that shows
 * the relation. Returns null on abstain, transport error, or invalid output
 * after the retry.
 */
export async function proposeRelation(cfg: BonsaiConfig, answer: string, candidates: Candidate[]): Promise<Proposal | null> {
  const pool = candidates.slice(0, 5);
  if (pool.length === 0) return null;

  const blocks = pool.map((c, i) => `Block ${i + 1}\nref: ${c.ref}\ntext: ${c.text}`).join('\n\n');
  const user = `Answer:\n${answer}\n\nBlocks:\n${blocks}`;
  return valueOrNull(await runJob(cfg, 'relation', RELATION_SYSTEM, user, (obj) => checkProposal(obj, pool)));
}
