# keep-writing

An Obsidian plugin for a vault that interviews its owner. It draws a source
from one of two jars, places a question in today's Sitting as an Ask, and
links the answer to what provoked it. The words in this README are the
vault's own; `CONTEXT.md` at the vault root defines them.

## What it does

- **Draw.** For the active Sitting, flip a coin between two jars. The Bank
  jar holds questions other people wrote; one is asked as it is, unanswered
  first, balanced across registers. The paragraph jar holds paragraphs the
  owner wrote, filed under Wells; the draw picks a Well uniformly among those
  with an unanswered paragraph, then a paragraph, and hands it to bonsai to
  compose the question. If a jar is empty, the other is used.
- **Ask.** Accept the drawn question and it lands at the end of `## Asked` as
  a `> [!ask]` callout whose second line cites the source block. The cursor
  goes to the line where your answer starts.
- **Mark answered.** The first paragraph under an Ask gets a block id and an
  `answers` link to the source. A non-Bank source gets `answered-by` back.
  A Bookmark question also writes `next` on the Target note, or on `me`.
- **Link.** Any paragraph can be linked to a note or block by one of five
  relations (`answers`, `echoes`, `contradicts`, `follows`, `demonstrates`).
  Both ends are written; Bank targets get no inverse.
- **Links pane.** Every typed link in and out of the active note, grouped by
  relation, with the rows for the block under the cursor highlighted, and a
  remove control on each row.

## The write surface

The plugin never writes body text. Everything it writes is one of:

1. A frontmatter property, through `app.fileManager.processFrontMatter`
   (`links.ts`, `asks.ts` for `next`).
2. A block id ` ^xxxxxx` appended to the last line of a paragraph
   (`blocks.ts#ensureBlockId`). No existing character changes. A paragraph
   of a Domain or Learning note gets its id this way, only when it is drawn
   and a question about it is accepted.
3. A `> [!ask]` callout, with one blank line after it, at the end of the
   `## Asked` section (`asks.ts#appendAsk`). If the heading is missing, the
   plugin adds it. A Revisit's callout carries a third line that embeds the
   paragraph (`> ![[Pieces/x#^p-004]]`); the paragraph itself is not copied.

One fallback creates a file: "Open today's Sitting" uses the daily-notes core
plugin's command. When that command is absent, the plugin copies
`Templates/Sitting.md` verbatim to `Sittings/YYYY-MM-DD.md`.

## Commands

| Command | What happens |
|---|---|
| Open Ask pane | Right sidebar: what the jars hold, one drawn source, open Asks, Proposals. |
| Open Links pane | Right sidebar: typed links of the active note. |
| Draw a question | Redraw. |
| Ask a closing question | Draw an entry tagged `#role/door`. |
| Mark answer under cursor as done | Link the answer the cursor is in to its Ask's source. |
| Ask about the selection | Compose a question about the words selected, in any note the owner writes paragraphs in. |
| Link this paragraph to… | Note, then block or whole note, then relation. |

The Ask pane's buttons: **Accept** inserts the Ask. **Skip** redraws and keeps
the skipped source out for this session. **Bookmark** draws an entry tagged
`#role/bookmark`; **Open door** draws one tagged `#role/door`. A role is read
off the entry, so a closing move is legal in any bank note; `Bank/closing.md`
is only where they are kept.
**Ask about selection** takes the words selected in the editor as the source;
it sits at the top of the pane and works while any note is open.

While roaming, the pane's header reads what is left to draw, for instance
`roaming · 3980 questions · 1102 paragraphs across 9 wells`. With `about`
set on the Sitting it reads `only <Target>`.

## The two jars

| Jar | What is in it | How it is asked |
|---|---|---|
| Bank | every list item with a block id and no `#role/` tag, in a `Bank/*.md` with `kind: bank` | as written |
| paragraphs | every paragraph with a block id in a finished Piece or a Sitting; every paragraph of a Domain or Learning note's body, id or not | bonsai composes the question (a Revisit) |

There are no forms with holes in them. A Bank question is asked as it is,
whoever it was written for. Everything that is about the owner's own practice
comes from a paragraph the owner wrote.

Seven draws in ten come from the Bank (`BANK_SHARE` in `bank.ts`). Not a half,
because a Revisit is not the only way the owner's own words come back: every
answer marked done offers up to three Follow-ups, and a Follow-up is not a
draw. It never passes through the jars. Whatever this share gives, the
Follow-ups sit on top of it.

A source is answered when any block carries an `answers` link to it. The same
rule holds for a question and for a paragraph.

### What a Well is

A Well is where a paragraph comes from, for balance and for the Lens:

| Well | Its paragraphs |
|---|---|
| the self (`me`) | Sittings, and the finished Pieces no Domain gathers |
| a note in `Domains/` | the finished Pieces it gathers, plus its own body |
| a note in `Learning/` | its own body |

A Well is entered by writing a paragraph in a note in `Domains/` or
`Learning/`. There is no command for it: a Well with no paragraph is silent,
and that silence is correct. The draw spreads across Wells, so a Learning note
with two paragraphs is drawn as often as a Domain with a hundred.

Which Domain a Piece belongs to is Gathering. A Domain note lists `gathers:`,
a list of tags; a finished Piece whose `tags` meet that list, or that links
the Domain in `about`, belongs to it. A Piece can belong to several Domains.
Nothing is stored on the Piece; `target.ts#gatheredBy` computes it on every
draw. An open Piece (no `status`) is not a Well and is not drawn.

Set `about` on a Sitting to one Well or one finished Piece to spend a day on
it: the Bank jar is then closed, and the paragraph jar holds that Well's
paragraphs only (a finished Piece: its own). Remove `about` to roam again.

## Revisits

A Revisit is an Ask whose source is a paragraph the owner wrote before. The
corpus of finished Pieces lives in `Pieces/`, one note per Piece, every prose
paragraph ending in a block id `^p-NNN`. Sitting answers carry the id they
got when marked done. A Domain or Learning body paragraph may have no id yet.

When the draw lands on a paragraph, the pane shows the paragraph and one line
of framing (title · date · publisher; `Sitting 2026-09-12`; the note's name).
There is no fixed question for it: the paragraph is prose, story, or poem, so
bonsai composes the question the way it composes a Follow-up, with the
paragraph as context and the framing (`in 2021, for Branch Magazine`; `in a
Sitting on 2026-09-12`; `in their note on Blender`; `in what they wrote about
wanting to learn Dutch`).

A paragraph of a Domain or Learning Well is read through a Lens. A Lens is a
note in `Lenses/`, prose, that tells bonsai where to look: `Lenses/craft.md`
for Domains, `Lenses/learning.md` for Learning notes. Its body, after the
frontmatter, is appended to the composition prompt verbatim (`lens.ts`), and
the framing line in the pane says so: `through the craft lens`. The self has
no Lens; the Bank is never steered. The learning Lens may end a question with
`(due +7d)`; the plugin strips the marker and writes the Ask with a `due:`
line that many days from today.

Up to three candidates appear, each with a +. Choosing one places the Ask with
the paragraph as its source, embedded under the from-line so it reads in
place. A paragraph without an id is given one at this moment, so the Ask can
cite it.

```
> [!ask] what did the buffaloes see that you left out?
> from [[Pieces/2021-feeling-through-the-cities-koramangala#^p-004]]
> ![[Pieces/2021-feeling-through-the-cities-koramangala#^p-004]]
```

With the model off, or when it offers nothing, one plain button asks the one
fixed form, "what would you write under this now?", so a paragraph is never a
dead end. Skip keeps the paragraph out for this session, like a question.

Marking the answer done writes `answers` on the answer block and `answered-by`
on the source note, so a Piece's properties list every answer that revisits
it. A Revisit never draws the paragraph into the well; it draws an answer
about it.

## Ask about the selection

The draw can only reach a paragraph that the jar holds, and the jar holds a
Sitting's blocks only when they carry an id — which means the first paragraph
of each marked answer, and nothing after it. "Ask about the selection" is the
way in by hand: select any run of text, in a Sitting, a Piece, a Domain or a
Learning note, and it becomes the source of a question composed exactly as a
Revisit is composed.

Three ways to it: the command **Ask about the selection**, the same item on
the editor's right-click menu, and the **Ask about selection** button at the
top of the pane.

What it takes from the note is the same as a drawn paragraph: the framing,
the Well, and so the Lens. The question is composed from the selection alone,
so selecting one sentence of a long paragraph asks about that sentence. The
Ask still cites the whole block that holds it, because a block is the
smallest thing Obsidian can link and embed. A block with no id is given one
when the Ask is accepted.

An Ask always lands in a Sitting. When the selection is in a Piece or a
Domain note, it lands in today's Sitting (made now if today has none) and the
pane says which. When the selection is in the Sitting already open, the
cursor goes under the new Ask, as a draw does.

## Enable it

1. Build: `npm install`, then `npm run build`. This produces `main.js`.
2. In Obsidian: Settings → Community plugins → turn off Restricted mode.
3. Enable **keep-writing** in the list.
4. Optional: Settings → keep-writing to change the Sittings or Bank folder.

`npm run dev` rebuilds on every change. `npm test` runs the unit tests.

## The model

`src/model.ts` is the seam for bonsai (`src/bonsai.ts`, `src/lexical.ts`).
It is on by default and calls `http://127.0.0.1:8088/v1`; switch it off in
settings and the plugin runs bank-only.

When you mark an answer done, two small jobs run, each one call at
temperature 0:

- **Follow-up.** bonsai reads the question and your whole answer and offers
  up to three next questions. They appear as a card in the Ask pane; the +
  next to one places it as an Ask whose source is your answer block. Code
  drops a candidate that hands your answer back, or that re-asks the question
  you just answered. If every candidate re-asks it, a second arm runs with
  the question removed and your answer alone, which is what makes the model
  let go of it (`scripts/probe-question-echo.ts` holds the measurement). An
  abstain is left alone: the model declining is a legal answer.
- **Revisit.** When the draw lands on a paragraph, bonsai reads it with one
  line of framing and the Well's Lens, and offers up to three questions,
  checked the same way.
- **Proposal.** Code finds up to five earlier blocks that share words with
  the answer; bonsai picks at most one and a relation (echoes, contradicts,
  follows) with a quote from it. Link writes the relation on both ends.
  Ignore drops it. Nothing is written without you.

Calls are logged to the developer console under `[keep-writing]`.
