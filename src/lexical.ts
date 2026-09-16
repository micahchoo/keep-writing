// Lexical candidate finder. Pure, synchronous, no dependencies.
//
// Used before a Proposal: code finds up to k blocks that share the most
// content words with a fresh answer, then bonsai judges the relation.
// See CONTEXT.md, "Proposal" and "Bonsai judges, code arbitrates".

export interface Block {
  ref: string;
  text: string;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'him', 'his', 'how', 'its', 'may',
  'now', 'new', 'old', 'see', 'two', 'way', 'who', 'did', 'get', 'got', 'let',
  'she', 'too', 'use', 'that', 'with', 'have', 'this', 'will', 'your', 'from',
  'they', 'been', 'were', 'said', 'each', 'which', 'their', 'there', 'what',
  'when', 'where', 'while', 'than', 'then', 'them', 'these', 'those', 'some',
  'such', 'into', 'over', 'also', 'only', 'very', 'just', 'like', 'more',
  'most', 'much', 'many', 'other', 'about', 'after', 'again', 'before',
  'being', 'both', 'could', 'does', 'doing', 'down', 'during', 'even', 'ever',
  'every', 'here', 'itself', 'made', 'make', 'might', 'must', 'never', 'once',
  'onto', 'same', 'shall', 'should', 'since', 'still', 'because', 'through',
  'under', 'until', 'upon', 'well', 'went', 'would', 'yet', 'own', 'off',
  'why', 'yes', 'nor', 'per', 'via', 'thing', 'things', 'something', 'anything',
  'nothing', 'really', 'quite', 'rather', 'always', 'sometimes', 'often',
  'myself', 'yourself', 'himself', 'herself', 'ourselves', 'themselves',
  'mine', 'yours', 'ours', 'theirs', 'whom', 'whose', 'against', 'between',
  'above', 'below', 'around', 'without', 'within', 'though', 'although',
  'however', 'whether', 'either', 'neither', 'else', 'thus', 'hence', 'lot',
  'kind', 'sort', 'want', 'wanted', 'know', 'knew', 'think', 'thought', 'say',
  'says', 'tell', 'told', 'come', 'came', 'going', 'take', 'took', 'give',
  'gave', 'put', 'keep', 'kept', 'first', 'last', 'next', 'back', 'still',
]);

const MIN_TOKEN_LENGTH = 3;

/** Lowercase, split on non-letters, drop stopwords and short tokens. */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}]+/u)) {
    if (raw.length < MIN_TOKEN_LENGTH) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/**
 * Find up to `k` blocks in `pool` that share the most content words with
 * `answer`. Shared distinct tokens are weighted by inverse document
 * frequency across `pool`; ties break toward the shorter text. A block whose
 * ref equals `excludeRef` is never returned. Returns [] when the best score
 * is 0.
 */
export function findCandidates(answer: string, pool: Block[], k: number, excludeRef?: string): Block[] {
  if (k <= 0 || pool.length === 0) return [];

  const answerTokens = contentTokens(answer);
  if (answerTokens.size === 0) return [];

  const poolTokens = pool.map((b) => contentTokens(b.text));

  const df = new Map<string, number>();
  for (const tokens of poolTokens) {
    for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = pool.length;
  const idf = (t: string): number => Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;

  const scored: { block: Block; score: number }[] = [];
  pool.forEach((block, i) => {
    if (excludeRef !== undefined && block.ref === excludeRef) return;
    let score = 0;
    for (const t of poolTokens[i]) {
      if (answerTokens.has(t)) score += idf(t);
    }
    if (score > 0) scored.push({ block, score });
  });

  if (scored.length === 0) return [];

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.block.text.length - b.block.text.length;
  });

  return scored.slice(0, k).map((s) => s.block);
}
