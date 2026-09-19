# keep-writing: the guide

Everything past the [README](../README.md).

## Where questions come from

Two jars. Seven draws in ten come from the first.

| Jar | What's in it | How it's asked |
|---|---|---|
| **The bank** | Questions other people wrote — every list item with a block id in a note in your bank folder whose frontmatter says `kind: bank` | As written |
| **Your writing** | Every block with an id, in the folders you name in settings | The model builds a question about it |

The starter bank is 2,274 questions across 22 kinds, in four notes grouped by what the *answer* is:

| Note | Questions | What it asks for |
|---|---|---|
| `autobiographical.md` | 918 | A life you already lived — one occasion, a thing that happened again and again, a stretch of years, a plain fact, what you take yourself to be, what you mean to do, what you hold worth it, why you think it happened, what you hold true, how it felt, what a change left behind |
| `autoethnographic.md` | 1,023 | The same life read as a culture, and an account of the telling |
| `learning.md` | 282 | What you understand, what your hands can do, and what you would have to go and find out |
| `invention.md` | 51 | Not retrieval at all: a prompt, whose answer does not exist until you write it |

None can be closed in a sentence, and none can be answered by a stranger. That last one is the whole test: 249 candidates were cut against it by eight independent judges before any of this shipped.

They arrive as notes, not as data inside the plugin, and that is load-bearing. A question is answered when a block links to it, so a question with no address in your vault could never be retired. Once written they are yours — edit them, delete them, add your own.

A bank note is ordinary Markdown: one question per list item, a `#register/…` tag saying what kind of answer it calls for, and a block id so the question can be cited.

```markdown
---
kind: bank
---

- what do you get complimented on the most? #register/value ^b17850831
- what did you make this week? #register/episode ^b17850832
```

A question is *answered* when any block in the vault carries an `answers` link to it. Answered questions leave the jar, as do ones already asked in the note you are writing in.

## Spending a day on one thing

Put `about: "[[some note]]"` in a daily note's frontmatter and the bank closes: only that note's paragraphs are drawn.

## Picking up tomorrow

Tag one bank question `#role/bookmark` — "where should we pick up?" is the one this vault uses — and keep it at the end of your daily note template. Answer it, mark it done, and the answer's address is written as `next`:

```yaml
---
next: "[[Sittings/2026-09-16#^a4f201]]"
---
```

On `me.md`, or on the note your day was `about`. The next day's draw offers that paragraph first, reads it as something you chose rather than something it found, and puts what you wrote under the question. It stops offering it once you answer it, or the next time you leave a bookmark.

## The three model jobs

One call each, temperature 0, JSON out, one retry, then it gives up quietly.

- **Follow-up** — reads the question and your whole answer, offers up to three next questions. Candidates that hand your answer back, re-ask what you just answered, or refer to the conversation are dropped in code before you see them.
- **Revisit** — for a paragraph you pointed at. Reads it with one line of framing (`in 2021, in "Koramangala"`) and asks about it.
- **Invitation** — for a paragraph the draw found. Reads it with *no* framing, finds the concern under it, and asks something you can answer from today.

Given the same list about georeferencing a map in QGIS, the Revisit asked *"what specific data layer did you align the PNG against?"* and the Invitation asked *"what does it cost to make a thing fit the map it was never drawn for?"*

![Three follow-up questions composed from one answer about a door handle: what the owner did with it, which key still fits it, and what the flat looked like in the rain.](https://raw.githubusercontent.com/micahchoo/keep-writing/main/docs/img/followup.png)

The model abstaining is a legal answer and is never worked around. Calls are logged to the developer console under `[keep-writing]` — the job, how long it took and how it ended, never the request or your key.

`Lenses/craft.md` and `Lenses/invitation.md` are prose notes whose bodies are appended to the prompt verbatim, one per composer. Edit them to change how the model asks: it is the interviewer's technique as a page you control, not a string in the source.

## Reading your vault in graph view

Every answer is linked, so after a few months the graph is a picture of the interview. One thing spoils it out of the box, and one filter fixes it.

**Filter the bank out.** Seven draws in ten come from your question bank, and the starter bank is four notes — so most links converge on four dots and the graph becomes a four-pointed star. In graph view's filter box:

```
-path:Bank
```

What is left is the part worth looking at: each day's writing tied to the older paragraphs that provoked it. A piece you keep returning to grows visible edges, because the plugin writes `answered-by` back onto whatever a question came from. The biggest node is the writing that keeps paying out.

**Colour by what you were asked.** Marking an answer records the kind of question on the note that answered it:

```yaml
registers:
  - episode
  - belief
```

In graph view → Groups → New group, one query per colour:

| Query | Shows |
|---|---|
| `["registers","episode"]` | days spent on things that happened |
| `["registers","belief"]` | days spent on what you hold true |
| `["registers","value"]` | days spent on what you hold worth it |

Then the shape of your attention is visible without reading a word — a season of retrieving episodes, a turn toward testing beliefs.

One thing the graph cannot show: follow-up chains. A follow-up cites the answer it came from in the same note, and Obsidian draws no link from a note to itself.

## What it will not do

The plugin never writes a sentence into your notes. Its entire write surface is three things:

1. **Frontmatter properties** — via Obsidian's own `processFrontMatter`.
2. **A block id** appended to a paragraph you already wrote (` ^a1b2c3`). No existing character changes.
3. **A `> [!ask]` callout**, at the end of the `## Asked` section.

There is no code path that inserts, edits or rewords prose. The body of a note is yours. Nothing is written without you picking it first, and Escape always means no.
