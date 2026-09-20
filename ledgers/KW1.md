# KW1 — delayed source identity

Status: done 2026-09-20. Started 2026-09-20. Synthetic fake vault only; no publication or real notes. Contract: every delayed acceptance anchors the original selected paragraph or refuses without a body mutation. Control phrases: log it, don't fix it yet; continue the ledger; classify only; the kill criterion stands.

## Inventory before fixes

| case or stage | expected | actual and measurement | verdict | fix commit | retest |
|---|---|---|---|---|---|
| unchanged | anchor original | original anchored, two writes including Ask | pass | no Git repository | completed below |
| preceding insertion | relocate original or refuse | unrelated preceding paragraph anchored | defect | no Git repository | completed below |
| selected text edit | refuse | replacement text anchored | defect | no Git repository | completed below |
| existing ID | reuse unchanged original | existing ID cited, one Ask write | pass | no Git repository | completed below |
| stale metadata with insertion | safely refuse or relocate | unrelated preceding paragraph anchored | defect | no Git repository | completed below |
| deleted text | refuse without writes | zero writes, notice | pass | no Git repository | completed below |
| duplicate selected text | refuse ambiguous identity | first copy anchored | defect | no Git repository | completed below |

Executed `/tmp/kw1-inventory.ts` with plugin test preload. Entry points: main.ts captures selection before model composition, Interview.selection constructs the source, acceptFrom holds it across composition/chooser waits, blocks.ts mutates through vault.process. Existing IDs bypass revalidation entirely. Inventory complete before source edits.

Lesson: positional references cannot preserve source identity across asynchronous work. Store the regression matrix in tests and retain this ledger; no separate global instruction is needed.

## Fix and retest

Source snapshots now carry the selected words and, for editor commands, the original full block. Delayed acceptance resolves existing IDs or a unique text match against a fresh read, checks supported block context and original text, and compares the complete read snapshot again inside vault.process. Changed, deleted, ambiguous or stale-metadata cases surface a refusal. Existing IDs are validated too; an unchanged atomic callback does not alter body text.

| case or stage | expected | actual and measurement | verdict | fix commit | retest |
|---|---|---|---|---|---|
| unchanged | anchor original | original receives ID | fixed/pass | working files; no Git | delayed-source.test.ts; inventory rerun |
| preceding insertion | relocate or refuse | unique original relocated and anchored; preceding text unchanged | fixed/pass | working files; no Git | delayed-source.test.ts |
| selected edit / deletion / duplicate | refuse without mutation | all three refuse; zero writes | fixed/pass | working files; no Git | delayed-source.test.ts |
| stale metadata | refuse without mutation | zero writes, changed/ambiguous notice | fixed/pass | working files; no Git | delayed-source.test.ts |
| existing ID moved | retain original ID | correct source link; original body unchanged | fixed/pass | working files; no Git | delayed-source.test.ts |
| existing ID edited/deleted | refuse | zero writes | fixed/pass | working files; no Git | delayed-source.test.ts |
| edit between read and atomic callback | refuse | concurrent replacement preserved; no Ask inserted | fixed/pass | working files; no Git | delayed-source.test.ts |

All inventory rows retested. Full suite: 273 pass, 8 live-model skip, 0 fail. Build and lint checks recorded with final KW2/KW3 validation. No actual vault touched. Harvest: lesson retained in this ledger and delayed-source regression tests; no new global instruction needed.

Status: done 2026-09-20.
