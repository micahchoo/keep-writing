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

/** Past this, a Notice is a wall of text nobody reads. */
const REASON_MAX = 160;

/**
 * The line for a compose call that FAILED, as against the model declining.
 * The two were one value until 2026-09-18 and the owner was told the model
 * had nothing to say whatever had happened — including a 404 naming a model
 * id their server does not have.
 *
 * The endpoint's own words are the useful part and are kept, bounded: "model
 * 'nope' not found" is the whole diagnosis, and no sentence written here can
 * replace it.
 */
export function modelFailureLine(reason: string): string {
  const said = reason.trim();
  if (!said) return 'The model did not answer.';
  return `The model did not answer. ${said.length > REASON_MAX ? said.slice(0, REASON_MAX) + '…' : said}`;
}
