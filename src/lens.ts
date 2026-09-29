// The Lens: a short steer, added to the end of a composer's prompt. It tells
// bonsai where to look. The interviewer's technique is text the owner can
// edit, which is the whole point of it.
//
// It is chosen by the PATH. The owner pointed at this paragraph, so ask about
// it: the craft Lens. The draw handed it over, so do not: the invitation Lens.
//
// It was a note in `Lenses/` until 2026-09-28. Only the vault this plugin was
// written in had one, so every other install composed with no Lens at all. It
// is a setting now, with a shipped default, and nothing reads `Lenses/`.

/** A steer, not a second prompt: the composer's own rules stay in bonsai.ts. */
export const MAX_LENS_WORDS = 100;

/** The Revisit's Lens: the owner pointed at a paragraph. */
export const CRAFT_LENS = `Prefer these, in order, before the list above. The paragraph is often about a practice or a piece of work: ask what happened, in order, before what it means. A moment it went wrong or nearly did: what they noticed first. A decision: what they checked just before it. A thing they made: what would break it. A named skill: what a beginner mistakes for it. Two things side by side: what separates them. A limit: what passing it costs. Anchor every question in something the paragraph names.`;

/** The Invitation's Lens: the draw handed the owner a paragraph. */
export const INVITATION_LENS = `The paragraph is old: a seed, not a subject. They have moved; ask where they stand now. Name one relationship, not a topic, with a tension that pulls two ways. Leave it open to many readings and to any form. Ask about their life, not their writing. Do not name the paragraph's subject if that only sends them back to it. For example: "What do we keep after its purpose is gone?" If nothing under it reaches their present, abstain: a weak invitation costs more than none.`;

/** Pure: words, as the owner would count them. */
export function lensWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Pure: why the settings box refuses this Lens, or undefined when it does not. */
export function lensProblem(text: string): string | undefined {
  const n = lensWords(text);
  return n > MAX_LENS_WORDS ? `This is ${n} words. Keep it to ${MAX_LENS_WORDS} or fewer.` : undefined;
}

/**
 * Pure: a stored Lens, cleaned. The box's `validate` guards what is typed, not
 * what data.json holds, so a Lens the box would have refused is not the
 * owner's Lens. '' means the shipped one.
 */
export function readLens(value: unknown): string {
  if (typeof value !== 'string' || lensProblem(value)) return '';
  return value.trim();
}

/** Pure: the Lens a composer reads — the owner's, or the shipped one when theirs is empty. */
export function lensText(stored: string, shipped: string): string {
  return stored.trim() || shipped;
}
