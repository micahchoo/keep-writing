# keep-writing

A vault that interviews you, so that you keep writing.

keep-writing puts a question into your daily note in [Obsidian](https://obsidian.md), you answer it in your own words, and every answer is linked to whatever provoked it. Over time the vault becomes the well your writing projects draw from — and the questions start coming from what you have already written.

> **Early, and not in the community store.** Install it manually (below). It ships with no question bank yet, so you bring your own or write one; a starter bank is the next thing planned. The follow-up questions need a local model, and everything else works without one.

## What it does

- **Draws a question** into today's note. Three at a time — pick one, or press Escape and nothing is written.
- **Turns your old writing into new questions.** Two ways, and which one you get depends on who chose the paragraph. Highlight one yourself and you are asked about *that paragraph*. Let the draw find one and it becomes a seed for a question about your life *now* — because most of what a draw can reach is years old, and a question about 2020 is a question for whoever you were then.
- **Follows up.** Mark an answer done and the model reads it, then offers the next question. Run it again on the same answer, next week, and it composes fresh ones.
- **Links every answer** to the question that caused it, in frontmatter, both ends. That is what stops a question coming back once you have answered it.
- **Never writes your prose.** See [What it will not do](#what-it-will-not-do).

## Getting started

1. Open today's daily note.
2. Run **Draw a question** (ribbon icon, command palette, or right-click → keep-writing).
3. Pick one of the three. It lands in your note and the cursor goes where your answer starts:

```markdown
## Asked

> [!ask] what do you get complimented on the most?
> from [[Bank/questions for meaningful introductions#^b17850831]]

▏
```

4. Write. Then, with the cursor still in your answer, run **Mark this answer done, and follow up**.

Your answer gets a block id and an `answers` link to the question. Then the model reads what you wrote and offers the next question:

```yaml
---
answers:
  - "[[Bank/questions for meaningful introductions#^b17850831]]"
---
```

## Commands

All three are on the editor's right-click menu, under **keep-writing**.

| Command | What happens |
|---|---|
| **Draw a question** | Three sources to choose from. A bank question becomes an Ask at once; a paragraph of yours goes to the model first, and its questions are the second chooser. |
| **Mark this answer done, and follow up** | Links the answer the cursor is in, then offers follow-up questions. Safe to run again on an answer already linked — it writes nothing and composes afresh. |
| **Ask about the selection** | Highlight any run of text, in **any** note, and be asked about it. The Ask lands in today's note. |

## Where questions come from

Two jars. Seven draws in ten come from the first.

| Jar | What's in it | How it's asked |
|---|---|---|
| **The bank** | Questions other people wrote — every list item with a block id in a note in `Bank/` whose frontmatter says `kind: bank` | As written |
| **Your writing** | Every block with an id in your daily notes, and in finished pieces in `Pieces/` | The model composes a question about it |

A bank note is ordinary Markdown. One question per list item, a `#register/…` tag saying what kind of answer it calls for, and a block id so the Ask can cite it:

```markdown
---
kind: bank
---

- what do you get complimented on the most? #register/value ^b17850831
- what did you make this week? #register/episode ^b17850832
```

A question is *answered* when any block in the vault carries an `answers` link to it. Answered questions leave the jar. So do ones already asked in the note you're writing in.

Put `about: "[[some note]]"` in a daily note's frontmatter to spend the day on one thing: the bank closes and only that note's paragraphs are drawn.

## What it will not do

The plugin never writes a sentence into your notes. Its entire write surface is three things:

1. **Frontmatter properties** — via Obsidian's own `processFrontMatter`.
2. **A block id** appended to a paragraph you already wrote (` ^a1b2c3`). No existing character changes.
3. **A `> [!ask]` callout**, at the end of the `## Asked` section.

There is no code path that inserts, edits or rewords prose. The body of a note is yours. Nothing is written without you picking it first, and Escape always means no.

## The model

Follow-up and revisit questions need an OpenAI-compatible endpoint. It's on by default and points at `http://127.0.0.1:8088/v1` — a local server. **Nothing leaves your machine unless you point it somewhere else.**

Turn it off in settings and the plugin runs bank-only: the draw, the Ask, and the linking all still work. You lose the questions composed from your own writing.

Two jobs, one call each, temperature 0, JSON out, one retry, then it gives up quietly:

- **Follow-up** — reads the question and your whole answer, offers up to three next questions. Candidates that hand your answer back, re-ask what you just answered, or refer to the conversation are dropped in code before you see them.
- **Revisit** — for a paragraph you pointed at. Reads it with one line of framing (`in 2021, in "Koramangala"`) and asks about it.
- **Invitation** — for a paragraph the draw found. Reads it with *no* framing, finds the concern under it, and asks something you can answer from today. Given the same list about georeferencing a map in QGIS, the Revisit asked "what specific data layer did you align the PNG against?" and the Invitation asked "what does it cost to make a thing fit the map it was never drawn for?"

The model abstaining is a legal answer and is never worked around. Calls are logged to the developer console under `[keep-writing]`.

`Lenses/craft.md` and `Lenses/invitation.md` are prose notes whose bodies are appended to the composition prompt verbatim — one per composer. Edit them to change how the model asks. It's the interviewer's technique as a page you control, not a string in the source.

## Installing

Not in the community plugins browser yet.

1. Clone or download this repo into `<your vault>/.obsidian/plugins/keep-writing`.
2. `npm install && npm run build` — this produces `main.js`.
3. Obsidian → Settings → Community plugins → turn off Restricted mode.
4. Enable **keep-writing**.

## Settings

| Setting | Default | |
|---|---|---|
| Sittings folder | `Sittings` | Where daily notes live |
| Bank folder | `Bank` | Where question notes live |
| Enable model | on | Off makes it bank-only |
| Base URL | `http://127.0.0.1:8088/v1` | Any OpenAI-compatible endpoint |
| Model | `bonsai-2-27b` | Model id sent to that endpoint |

A `Templates/Sitting.md` with a `## Asked` heading is copied into a new daily note when the plugin has to make one. Anything under a later heading stays at the bottom, below every drawn question.

## Development

```bash
npm install
npm run dev     # rebuild on change
npm test        # unit tests, no vault and no model needed
npm run build   # typecheck, then bundle
```

`test/fake-vault.ts` stands in for Obsidian's `App` — reads and the whole write surface — so the interview can be run and tested with no Obsidian and no DOM.

Tests that need a live model are skipped unless `KW_LIVE=1` and a server answers on the configured address.
