// A Refusal: the plugin declining to do something, carrying the one line the
// owner reads. See CONTEXT.md, "Refusal".
//
// Nothing here touches the vault, the DOM or `obsidian`. A refusal is raised
// where the reason is known and said by whoever is speaking to the owner —
// the Interview's Surface, or a command's Notice.
//
// Four catch sites each decided for themselves which errors were the owner's,
// each writing `e instanceof X ? e.message : String(e)`. They all agreed about
// refusals and were all wrong about everything else: a TypeError from anywhere
// reached the owner in the same voice as "Select the words to ask about
// first." A defect is not guidance.

/**
 * Thrown when the plugin will not do something and the owner should know why.
 * The message IS the line they read, so write it as a sentence to a person.
 */
export class Refused extends Error {}

const DEFECT = 'Something went wrong. See the developer console.';

/**
 * The line to show the owner for a thrown thing. A Refusal says itself;
 * anything else is a defect, logged where a developer will find it and named
 * as one to the owner.
 */
export function refusalLine(e: unknown): string {
  if (e instanceof Refused) return e.message;
  console.error('[keep-writing]', e);
  return DEFECT;
}
