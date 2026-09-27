# Ordinary-life Bank review

Reviewed 2026-09-26. Final bank: 100 questions, `ol-001` through `ol-100`.

The source rubric was the personal vault's `.bin/curation/RUBRIC.md`, titled
“The Bank test.” Its deciding test is “the agent cannot guess the answer.”
The adjacent `PROMPT-RUBRIC.md` was read to confirm the distinction: its
submission-call criteria apply to invention, not these personal questions.
Those local source files are outside this repository.

One reviewing agent read all 100 draft entries against the Bank test. Each
question had to seek particulars from one life, ask one thing, and stand alone
when drawn without its heading. The review also checked for answer menus,
flattering premises, inspirational filler, and dead yes/no questions. Plain
questions and answers that could be short were kept.

The review revised 35 entries and retained 65 as written. Examples of the
revisions:

- Removed near repeats about an unopened drawer, checking twice, departure
  routines, and spare time. Those invitations already occur in shipped banks.
- Replaced broad wording about an “ordinary occasion” with ingredients already
  bought, and “settling into a day” with the first noticed time today.
- Removed the menus in “dries, cools, or settles” and “taste, read, or look at.”
  The replacements ask about a thing ruined before it dried and pictures sent
  by someone close.
- Removed the suggestion that the owner noticed a change before anyone else.
  The replacement asks what was missing when they went to use it.
- Separated repeated invitations within the draft, including nearby belongings
  and sounds with unknown sources.

The final questions retain everyday mistakes and irritations alongside familiar
pleasures. They do not require a lesson, a meaningful turning point, or personal
growth. Subject headings do not introduce new registers: the bank uses 13
existing register names. Tags were adjusted where revisions changed the kind of
answer requested.

Verification used the real `parseBankLine` function with the test environment's
Obsidian mock. All 100 entries produced question text and an existing register,
with no block-ID or tag debris, role, or due date. IDs are unique and consecutive.
Normalized exact-question comparison found no duplicates within the new bank
or against the other 2,274 shipped entries. Lexical similarity candidates and
topic searches supported the manual check for near repeats.

This was one editorial review, not an independent multi-judge pipeline.
Mechanical checks do not prove semantic uniqueness or editorial quality.
No reader trial or live-vault draw was performed for this prose review.
