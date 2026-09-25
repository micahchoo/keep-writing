# keep-writing

A vault that interviews you, so that you keep writing.

A blank page stops you; a question doesn't. keep-writing puts one into your daily note in [Obsidian](https://obsidian.md), you answer it in your own words, and the next questions come out of what you already wrote — so it never runs out.

![In a daily note, an answer is written under a question; "Mark this answer done, and follow up" is chosen from the right-click menu; the answer gains a block id and a link to the question it answers; the model offers three follow-up questions from what was written, and the chosen one lands below the answer.](https://raw.githubusercontent.com/micahchoo/keep-writing/main/docs/img/loop.gif)

> **In the community store, and early.** Search community plugins for **keep-writing**. Needs **Obsidian 1.13 or newer**. Questions built from your own writing need a model endpoint; everything else works without one.

## What it does

- **Starts the day for you.** A new daily note is born holding a question, whoever made the note. No model call on that path, so it cannot fail.
- **Draws a question** into today's note. Three to choose from — pick one, or press Escape and nothing is written.
- **Turns your old writing into new questions.** Highlight a paragraph and you are asked about *that paragraph*. Let the draw find one and you get a question about your life *now* — most of what it can reach is years old, and a question about 2020 is a question for whoever you were then.
- **Follows up.** Mark an answer done and the model reads it, then offers the next question. Run it again next week and it writes fresh ones.
- **Opens where you stopped.** Leave a note about where to pick up, and tomorrow's first question comes from what you wrote, with your own words under it.
- **Links every answer** to the question that caused it, which is what stops a question coming back once you have answered it.
- **Grows pieces out of days.** A question and its follow-ups can leave the daily note and become a piece of its own, with every link following the words.
- **Never writes your prose.** It adds frontmatter, a block id, and the question itself — nothing else. No sentence of yours is ever inserted, edited or reworded.

## Getting started

On first run it offers to fill your question bank: 2,274 questions written for this, as four plain Markdown notes you can edit or delete.

1. Open today's daily note.
2. Run **Draw a question** — ribbon icon, command palette, or right-click.
3. Pick one. It lands in your note and the cursor goes where your answer starts:

```markdown
## Asked

> [!ask] what do you get complimented on the most?
> from [[Bank/autobiographical#^b17850831]]

▏
```

![The draw offering three sources: two bank questions with their kind and address underneath, and one paragraph the owner wrote a week earlier, marked as a revisit.](https://raw.githubusercontent.com/micahchoo/keep-writing/main/docs/img/draw.png)

4. Write. Then, with the cursor still in your answer, run **Mark this answer done, and follow up**.

Your answer gets an id and a link back to the question, and the model reads what you wrote to offer the next one.

## Commands

On the editor's right-click menu under **keep-writing**, and in the command palette.

| Command | What happens |
|---|---|
| **Draw a question** | Three to choose from. A bank question is written straight in; a paragraph of yours goes to the model first. |
| **Mark this answer done, and follow up** | Links the answer the cursor is in, then offers what follows from it. Run it again for fresh follow-ups. |
| **Ask about the selection** | Highlight text in **any** note and be asked about it. The question lands in today's note. |
| **Install the starter question bank** | Writes the question notes into your bank folder. Skips anything already there. |
| **Graduate threads to pieces** | In a daily note, turns a question and its follow-ups into a piece of writing of its own: your words moved as written, the questions as headings. |

![Graduating a daily note's thread: "Graduate threads to pieces" from the right-click menu; a form with three lines on what the thread is about, a title typed in, and suggested headings filled in; then the new piece, with its title, date, headings and the answers as they were written.](https://raw.githubusercontent.com/micahchoo/keep-writing/main/docs/img/graduate.gif)

![Obsidian's right-click menu with a keep-writing submenu open, holding Draw a question, Mark this answer done, and Graduate threads to pieces.](https://raw.githubusercontent.com/micahchoo/keep-writing/main/docs/img/menu.png)

## On a phone

Where the editor menu opens on a phone, its keep-writing actions are listed flat, because a submenu wants a hover. The quickest way in is the toolbar: in Settings → Toolbar, add **keep-writing: Draw a question** and **keep-writing: Mark this answer done, and follow up**.

## Settings

Findable from Obsidian's own settings search: type "bank folder" or "endpoint" anywhere in Settings.

| Setting | |
|---|---|
| **Daily notes folder** | Where your daily notes are, chosen from your folders. Default `Sittings`. |
| **Question bank folder** | Where the questions are kept, chosen from your folders. Default `Bank`. |
| **Ask about writing in** | The folders the plugin reads and asks about, added from a dropdown. Your daily notes are there at first; add a folder of finished writing, which is also where graduated pieces go. |
| **Bank share** | Default 70%. Choose how often to draw a bank question instead of your writing. An empty jar falls back to the other. |
| **Use a model** | Off makes it bank-only, with no network call at all. |
| **Endpoint** | Any OpenAI-compatible server. Default is one on your own computer. For Ollama: `http://localhost:11434/v1` |
| **Model** | Must name a model your server has. |
| **Reply budget** | Raise it if you get no questions and no error. Default `2048`. |
| **API key** | Only if your server needs one. Saved in Obsidian secret storage on this device; existing plaintext settings migrate automatically. |

![The plugin's settings, in two groups. Vault: the bank share, the daily notes and question bank folders chosen from dropdowns, and the folders it reads your writing from, with an Add a folder dropdown. Model: a switch, the endpoint, the model name, the reply budget and an API key.](https://raw.githubusercontent.com/micahchoo/keep-writing/main/docs/img/settings.png)

**Nothing you write leaves your computer** unless you point the endpoint somewhere else. That is the whole of what changes.

## More

The [guide](docs/guide.md) covers where questions come from and how the bank is built, spending a day on one note, picking up where you stopped, how the three model jobs differ, and how to read your vault in graph view.

## Licence

Two licences, because there are two kinds of thing here.

- **The code is [MIT](LICENSE).**
- **The question bank in [`starter/`](starter/) is [CC BY-SA 4.0](starter/LICENSE).** It is writing, not code. Share and adapt it, as long as you credit the source and license what you build under the same terms.

[`NOTICE`](NOTICE) says which is which. **Your answers are yours** — neither licence reaches anything you write.

## Development

```bash
npm install
npm run dev     # rebuild on change
npm test        # unit tests, no vault and no model needed
npm run build   # typecheck, then bundle
```

`test/fake-vault.ts` stands in for Obsidian's `App` — reads and the whole write surface — so the interview runs and is tested with no Obsidian and no DOM. Tests needing a live model are skipped unless `KW_LIVE=1`.

Releases are not cut by hand. Pushing a bare semver tag (`0.2.0`, never `v0.2.0`) runs [`.github/workflows/release.yml`](.github/workflows/release.yml), which checks the tag against `manifest.json` and `versions.json`, tests, builds, attests the assets and publishes them. Every release is signed against the commit it was built from, which matters here because `main.js` carries all 2,274 questions and nobody can diff those by eye:

```bash
gh attestation verify main.js --repo micahchoo/keep-writing
```
