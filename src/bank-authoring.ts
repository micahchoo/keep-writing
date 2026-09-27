import { normalizePath } from 'obsidian';
import type { App, TFile } from 'obsidian';

/** A new bank names one file inside the configured folder, never a path. */
export function bankName(input: string): string {
  const name = input.trim().replace(/\.md$/i, '');
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|#]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32) || /[. ]$/.test(name)) {
    throw new Error('Choose a bank name without slashes or filename punctuation.');
  }
  return name;
}

/** Instructions can be copied before creating a note, or found again in the empty note. */
export function bankInstructions(folder: string, name: string): string {
  const title = bankName(name);
  return `Create a keep-writing question bank about ${title}.

Return one complete Markdown note for ${normalizePath(`${folder}/${title}.md`)}. If this note already has questions, preserve their wording and block ids unless I ask you to revise them. Do not change any other bank or plugin settings.

Use this frontmatter:
---
kind: bank
title: ${JSON.stringify(title)}
---

Unless I request open writing prompts, write a personal question bank. Judge each question against this test: a stranger cannot supply the owner's actual answer. Ask one thing per question. Keep plain questions when their details belong to this person; a short answer is allowed. Leave room for an experience or story without prescribing a lesson.

For personal questions, cut generic answers, menus of suggested answers, flattering assumptions about growth, inspirational filler, questions about the interviewer, dangling references to an earlier question, and dead yes/no questions. Do not invent experiences for the owner. An arguable view of the world can open a question; do not reject one merely because it is difficult, dark, or odd. Prefer a distinct voice to generic journaling language.

For a personal bank, use existing answer registers where they fit: episode, general-event, lifetime-period, fact, construct, intention, value, causal-theory, belief, state, transformative, knowledge, skill, research-spur, membership, positionality, relation, telling, embodiment, artifact, structure.

If I specifically ask for open writing prompts instead of personal questions, use register invention and its separate rubric: distinctive focus, generative depth, interpretive openness, freedom of form and genre, clarity and economy. Score each 0–2; keep only totals of at least 8/10 with 2 for both openness and freedom. Do not apply the personal Bank test to these prompts, or the invention rubric to personal questions. Leave the form open; a prompt can become a story, argument, list, poem, or something else.

For that invention rubric, distinctive focus means a particular relationship or tension; generative depth means it can sustain exploration; openness means several readings are possible and assumptions can be challenged; freedom means the writer chooses form and genre; clarity means brief, accessible wording without assigning characters, techniques, or extra tasks.

Put each question on ONE list-item line, with one register tag and a unique block id at the end. Use a distinctive prefix for this bank, letters/numbers/hyphens only. Check ids against the other banks if available. Example syntax:
- what do you recognise by touch in your pocket? #register/embodiment ^custom-pocket-001

Headings may group questions. Every entry must make sense on its own. Do not put questions in tables or code fences. Do not add role tags or due dates. Remove duplicate and near-duplicate questions. Review every entry against its rubric before returning the note; syntax checks alone do not establish quality.

The plugin discovers notes with kind: bank inside ${normalizePath(folder)}. After saving, use Settings → keep-writing → Question banks → Installed banks to choose how often this bank appears. A value of 0 pauses it without deleting it.`;
}

/** Create an empty bank with readable authoring instructions, without a drawable example question. */
export async function createBank(app: App, folder: string, input: string): Promise<TFile> {
  const name = bankName(input);
  const directory = normalizePath(folder);
  const path = normalizePath(`${directory}/${name}.md`);
  if (app.vault.getAbstractFileByPath(path)) throw new Error('A note with this bank name already exists. Open it to add questions.');
  if (!app.vault.getFolderByPath(directory)) await app.vault.createFolder(directory);
  const instructions = bankInstructions(directory, name);
  // A fence keeps the syntax example out of Obsidian's list-item/block index.
  return app.vault.create(path, `---\nkind: bank\ntitle: ${JSON.stringify(name)}\n---\n\n# ${name}\n\nAdd your questions below. Copy these instructions to your agent to create them.\n\n\`\`\`text\n${instructions}\n\`\`\`\n`);
}
