// The Lens: the steer at the end of a composer's prompt. It tells bonsai where
// to look. The interviewer's technique is text the owner can edit, which is
// the whole point of it. Since 2026-09-29 it holds the where-to-look list
// itself, which was fixed in the prompt before; the Follow-up has one too; and
// the Stance, who asks, is the owner's as well. The task and the reply
// contract are not (bonsai.ts): the code checks every reply against them.
//
// It is chosen by the PATH. The owner pointed at this paragraph, so ask about
// it: the craft Lens. The draw handed it over, so do not: the invitation Lens.
//
// It was a note in `Lenses/` until 2026-09-28. Only the vault this plugin was
// written in had one, so every other install composed with no Lens at all. It
// is a setting now, with a shipped default, and nothing reads `Lenses/`.

/**
 * A steer, not a second prompt: the composer's task and the reply contract
 * stay in bonsai.ts, and nothing the owner writes removes them. 100 until
 * 2026-09-29, when the where-to-look list moved into the Lens; the longest
 * shipped Lens is 179 words.
 */
export const MAX_LENS_WORDS = 250;

/** One sentence naming who asks. */
export const MAX_STANCE_WORDS = 30;

/**
 * The shape a stored Lens is in. Absent: written before 2026-09-29, when a
 * Lens was appended AFTER the where-to-look list rather than holding it.
 */
export const LENS_VERSION = 2;

/**
 * Who asks, for the two jobs that are interviews (the Follow-up and the
 * Revisit). One sentence; the Invitation has none.
 */
export const STANCE = 'You are an autoethnographic interviewer.';

/**
 * Where an interview looks, shared by the Follow-up and the Revisit, which
 * ship with the same list. Each is its own Lens, so an owner can change one.
 */
const WHERE_TO_LOOK = `Where to look for the question, in order of preference:
1. A term they coined or use oddly: ask what it means to them, with an example.
2. A thing they named but did not open: ask about it.
3. An abstraction with no scene under it: ask for the moment it comes from.
4. A pole with no contrast: ask what the opposite would be.
5. A cause claimed with no event: ask what happened.
6. A trailing thought, a "might", a tag, an aside: ask what is behind it.`;

/** The Follow-up's Lens: the owner marked an answer. */
export const FOLLOW_UP_LENS = WHERE_TO_LOOK;

/** Where the Revisit looked before the Lens held it: kept apart for `upgradeLens`. */
export const REVISIT_WHERE = WHERE_TO_LOOK;

/** The Revisit's Lens: the owner pointed at a paragraph. */
export const CRAFT_LENS = `${REVISIT_WHERE}

Prefer these, in order, before the list above. The paragraph is often about a practice or a piece of work: ask what happened, in order, before what it means. A moment it went wrong or nearly did: what they noticed first. A decision: what they checked just before it. A thing they made: what would break it. A named skill: what a beginner mistakes for it. Two things side by side: what separates them. A limit: what passing it costs. Anchor every question in something the paragraph names.`;

/** Where the Invitation looked before the Lens held it: kept apart for `upgradeLens`. */
export const INVITATION_WHERE = `Where to find the concern, in order of preference:
1. A tension they held without resolving: name it as a question about now.
2. A cost they paid or refused to pay: ask where that cost falls today.
3. A thing they treated as permanent: ask what it would mean for it to end.
4. A distinction they leaned on: ask where it stops holding.
5. A want with no object: ask what it is reaching for.`;

/** The Invitation's Lens: the draw handed the owner a paragraph. */
export const INVITATION_LENS = `${INVITATION_WHERE}

The paragraph is old: a seed, not a subject. They have moved; ask where they stand now. Name one relationship, not a topic, with a tension that pulls two ways. Leave it open to many readings and to any form. Ask about their life, not their writing. Do not name the paragraph's subject if that only sends them back to it. For example: "What do we keep after its purpose is gone?" If nothing under it reaches their present, abstain: a weak invitation costs more than none.`;

/** Pure: words, as the owner would count them. */
export function lensWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Pure: why the settings box refuses this Lens, or undefined when it does not. */
export function lensProblem(text: string, max = MAX_LENS_WORDS): string | undefined {
  const n = lensWords(text);
  return n > max ? `This is ${n} words. Keep it to ${max} or fewer.` : undefined;
}

/**
 * Pure: a stored Lens, cleaned. The box's `validate` guards what is typed, not
 * what data.json holds, so a Lens the box would have refused is not the
 * owner's Lens. '' means the shipped one.
 */
export function readLens(value: unknown, max = MAX_LENS_WORDS): string {
  if (typeof value !== 'string' || lensProblem(value, max)) return '';
  return value.trim();
}

/**
 * Pure: a stored Lens in today's shape. One edited before LENS_VERSION was
 * written to follow the where-to-look list, so it keeps the list in front;
 * read as it is, it would replace the list. Empty stays empty — the shipped
 * Lens, which already holds the list.
 */
export function upgradeLens(stored: unknown, where: string, version: unknown): unknown {
  if (version === LENS_VERSION || typeof stored !== 'string' || !stored.trim()) return stored;
  return `${where}\n\n${stored.trim()}`;
}

/** Pure: the Lens a composer reads — the owner's, or the shipped one when theirs is empty. */
export function lensText(stored: string, shipped: string): string {
  return stored.trim() || shipped;
}
