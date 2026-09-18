# keep-writing

A vault that interviews you, so that you keep writing.

keep-writing puts a question into your daily note in [Obsidian](https://obsidian.md), you answer it in your own words, and every answer is linked to whatever provoked it. Over time the vault becomes the well your writing projects draw from — and the questions start coming from what you have already written.

> **Early, and not in the community store.** Install it manually (below). Questions composed from your own writing need a model endpoint; everything else works without one.

## What it does

- **Starts the day for you.** A new daily note is born with one question already in it, whoever made the note. No model call on that path, so it cannot fail.
- **Draws a question** into today's note. Three at a time — pick one, or press Escape and nothing is written.
- **Opens where you stopped.** Answer "where should we pick up?" at the end of a sitting and tomorrow's first offered question comes from what you wrote, with your own words under it.
- **Turns your old writing into new questions.** Two ways, and which one you get depends on who chose the paragraph. Highlight one yourself and you are asked about *that paragraph*. Let the draw find one and it becomes a seed for a question about your life *now* — because most of what a draw can reach is years old, and a question about 2020 is a question for whoever you were then.
- **Follows up.** Mark an answer done and the model reads it, then offers the next question. Run it again on the same answer, next week, and it composes fresh ones.
- **Links every answer** to the question that caused it, in frontmatter, both ends. That is what stops a question coming back once you have answered it.
- **Never writes your prose.** See [What it will not do](#what-it-will-not-do).

## Getting started

On first run it offers to fill your question bank: 2,274 questions written for this, as four plain Markdown notes in `Bank/`. Say yes, or run **Install the starter question bank** later. Nothing is overwritten and nothing is sent anywhere.

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
| **Install the starter question bank** | Writes the shipped question notes into your bank folder. Skips any note already there, so it is safe to run twice. |
| **Draw a question** | Three sources to choose from, led by where you said to pick up. A bank question becomes an Ask at once; a paragraph of yours goes to the model first, and its questions are the second chooser. |
| **Mark this answer done, and follow up** | Links the answer the cursor is in, then offers follow-up questions. Safe to run again on an answer already linked — it writes nothing and composes afresh. |
| **Ask about the selection** | Highlight any run of text, in **any** note, and be asked about it. The Ask lands in today's note. |

## Where questions come from

Two jars. Seven draws in ten come from the first.

| Jar | What's in it | How it's asked |
|---|---|---|
| **The bank** | Questions other people wrote — every list item with a block id in a note in `Bank/` whose frontmatter says `kind: bank` | As written |
| **Your writing** | Every block with an id, in the folders you name in settings | The model composes a question about it |

The starter bank is 2,274 questions across 22 registers, in four notes grouped by what the *answer* is:

| Note | Questions | What it asks for |
|---|---|---|
| `autobiographical.md` | 918 | A life you already lived — one occasion, a thing that happened again and again, a stretch of years, a plain fact, what you take yourself to be, what you mean to do, what you hold worth it, why you think it happened, what you hold true, how it felt, what a change left behind |
| `autoethnographic.md` | 1,023 | The same life read as a culture, and an account of the telling — membership, positionality, relation, telling, embodiment, artifact, structure |
| `learning.md` | 282 | What you understand, what your hands can do, and what you would have to go and find out |
| `invention.md` | 51 | Not retrieval at all: a prompt, whose answer does not exist until you write it |

None of them can be closed in a sentence, and none can be answered by a stranger — that last one is the whole test, and 249 candidates were cut against it by eight independent judges before any of this shipped.

They arrive as notes, not as data inside the plugin, and that is load-bearing: a question is answered when a block links to it, and a question with no address in your vault could never be retired. Once written they are your notes. Edit them, delete them, add your own.

A bank note is ordinary Markdown. One question per list item, a `#register/…` tag saying what kind of answer it calls for, and a block id so the Ask can cite it:

```markdown
---
kind: bank
---

- what do you get complimented on the most? #register/value ^b17850831
- what did you make this week? #register/episode ^b17850832
```

Your daily notes folder is the only one named to start with, so your own answers come back to you from day one. Add a folder of finished writing and the plugin reaches into that too. Nothing outside those folders is read, and a note with `status: page` in its frontmatter is skipped.

A question is *answered* when any block in the vault carries an `answers` link to it. Answered questions leave the jar. So do ones already asked in the note you're writing in.

Put `about: "[[some note]]"` in a daily note's frontmatter to spend the day on one thing: the bank closes and only that note's paragraphs are drawn.

## Picking up tomorrow

Tag one bank question `#role/bookmark` — "where should we pick up?" is the one this vault uses — and keep it at the end of your daily note template. Answer it, mark it done, and the answer's address is written as `next`:

```yaml
---
next: "[[Sittings/2026-09-16#^a4f201]]"
---
```

On `me.md`, or on the note your day was `about`. The next day's draw offers that paragraph first, reads it as something you chose rather than something it found, and puts what you wrote under the question. It stops offering it once you answer it, or the next time you leave a bookmark.

## What it will not do

The plugin never writes a sentence into your notes. Its entire write surface is three things:

1. **Frontmatter properties** — via Obsidian's own `processFrontMatter`.
2. **A block id** appended to a paragraph you already wrote (` ^a1b2c3`). No existing character changes.
3. **A `> [!ask]` callout**, at the end of the `## Asked` section.

There is no code path that inserts, edits or rewords prose. The body of a note is yours. Nothing is written without you picking it first, and Escape always means no.

## The model

Composing a question from your own writing needs an OpenAI-compatible endpoint. Any will do — a local server, or a hosted one with an API key. It ships pointing at `http://127.0.0.1:8088/v1` with the key field empty, so **nothing configured, nothing leaves.** Point it somewhere else and your paragraphs go there instead; that is the whole of what changes.

Turn the model off in settings and the plugin makes no network call at all: the draw, the Ask, the seeded question and the linking all still work. You lose the questions composed from your own writing.

Three jobs, one call each, temperature 0, JSON out, one retry, then it gives up quietly:

- **Follow-up** — reads the question and your whole answer, offers up to three next questions. Candidates that hand your answer back, re-ask what you just answered, or refer to the conversation are dropped in code before you see them.
- **Revisit** — for a paragraph you pointed at. Reads it with one line of framing (`in 2021, in "Koramangala"`) and asks about it.
- **Invitation** — for a paragraph the draw found. Reads it with *no* framing, finds the concern under it, and asks something you can answer from today. Given the same list about georeferencing a map in QGIS, the Revisit asked "what specific data layer did you align the PNG against?" and the Invitation asked "what does it cost to make a thing fit the map it was never drawn for?"

The model abstaining is a legal answer and is never worked around. Calls are logged to the developer console under `[keep-writing]` — the job, how long it took and how it ended, never the request or your key.

Your key is stored in plain text at `.obsidian/plugins/keep-writing/data.json`, like every Obsidian setting. Don't commit that file to a public repository.

`Lenses/craft.md` and `Lenses/invitation.md` are prose notes whose bodies are appended to the composition prompt verbatim — one per composer. Edit them to change how the model asks. It's the interviewer's technique as a page you control, not a string in the source.

## Installing

Not in the community plugins browser yet.

1. Clone or download this repo into `<your vault>/.obsidian/plugins/keep-writing`.
2. `npm install && npm run build` — this produces `main.js`.
3. Obsidian → Settings → Community plugins → turn off Restricted mode.
4. Enable **keep-writing**, and say yes when it offers to write the question bank.

## Settings

| Setting | Default | |
|---|---|---|
| Sittings folder | `Sittings` | Where daily notes live |
| Bank folder | `Bank` | Where question notes live |
| Draw your own writing from | `Sittings` | One folder per line. Every block with an id in these can be drawn |
| — | — | The starter bank is offered once; **Install the starter question bank** does it any time |
| Enable model | on | Off makes it bank-only |
| Base URL | `http://127.0.0.1:8088/v1` | Any OpenAI-compatible endpoint |
| Model | `bonsai-2-27b` | Model id sent to that endpoint |
| API key | empty | Sent as a bearer token. A local server needs none |

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
