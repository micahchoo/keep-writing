# Keep Writing — correctness and larger-vault round

Status: done 2026-09-20. Started 2026-09-20. Source/test base now includes upstream 0.2.7 (a568a7e), merged with round-one fixes. Versions/release publication belong to root. Only synthetic notes and mocked transport; no real vault.

Contract: inventory before fixes, preserve upstream bank-share/secret-storage/recovery/unmark and configured-folder semantics; verify asynchronous cache lifetime, source identity at mutation, and 100k/250k-note extraction with work counts and timer gaps. Controls: log it, don't fix it yet; continue the ledger; classify only; the kill criterion stands.

| Case | Expected | Actual before fix | Verdict | Fix | Retest |
|---|---|---|---|---|---|
| cached read pending during unload | no stale result after disposal | ExtractionCache.get resolves `obsolete` after dispose | correctness defect | implemented below | verified below |
| failed old read after invalidation | retry current generation | rejects old error, loader called once | correctness defect | implemented below | verified below |
| mark command pending across answer edit | refuse or anchor original text | markAnswered stamps unrelated replacement and writes answers relation | correctness defect | implemented below | verified below |
| merged incremental cold roaming at100k | cooperative bounded stages | 2474ms with zero timer callbacks; max gap2474ms | scaling defect | implemented below | verified below |
| cold target at100k | one content read; yield answer indexing | one read but100k metadata reads;72ms gap | scaling defect | implemented below | verified below |
| warm roaming at100k | reuse extraction with bounded selection work | zero reads,63ms unsliced flatten/dedup/filter/removal | scaling defect | implemented below | verified below |
| full invalidation at100k | chunk metadata/extraction | ~1.4s gap, one changed content read but200k metadata reads | scaling defect | implemented below | verified below |
| 10k/50k long-note extraction | bounded chunked stages |132/549ms;30/110ms max gaps | scaling defect | implemented below | verified below |
| upstream integration | retain upstream features and round-one safety |283 tests pass/8 skip; build/lint pass | preserved | three-way source/test integration | complete |

Reproductions: `ledgers/probes/kw-round2-correctness.ts`, `kw-round2-scale.ts`. Before outputs: `ledgers/measurements/kw-round2-correctness-before.txt`, `kw-round2-integrated-before-100k.jsonl`, `kw-round2-integrated-before-250k.jsonl`. The100k baseline's change rows use full invalidation;250k probe and subsequent runs invalidate the changed file, matching upstream events. Earlier pre-integration results retained separately as `kw-round2-before-100k.jsonl`.

Observed mechanisms: merged incremental index invokes per-file extraction with a fresh yield deadline, so many short-file loads never yield; pending entries restart a Map iterator after each deletion; aggregate rows/duplicate selection and draw removal allocate full arrays synchronously. Long blockTexts splits/sorts/maps before its caller can yield. Marked Ask ranges have no captured text snapshot and still use the older positional ensureBlockId path. Cache disposal drops retention but allows obsolete result delivery.

250k measured before edits: cold target173ms/250k metadata reads; cold roaming11.33s with no timer ticks; warm roaming203ms; one-file changes152–200ms despite only one content read. Metadata on changed-file runs is correctly four reads; aggregate work causes the remaining stall. Inventory complete; fixes now authorized by the round-two request.

## Implemented corrections

- Source mutation: `parseAsks` retains original answer text. `markAnswered` validates both that text and its owning question/source at the relocated first block inside the atomic write. Independent review added source replacement, changed question and deleted-Ask cases: all refuse with zero writes. Lists retain their first-item anchor.
- Cache lifetime: disposed caches reject pending/new work rather than delivering stale results; invalidated failed reads retry the current generation. Plugin commands suppress cancellation and completed model offers cannot reopen a chooser after unload. Folder renames clear extraction entries as the incremental index rescans scope.
- Incremental scaling: one shared work budget spans metadata initialization, queued file loads, block extraction and duplicate classification. The pending Map is traversed once instead of restarting at tombstones after each removal. Unchanged aggregate jars are retained; edits rebuild them cooperatively. Draw removal uses in-place splicing on the draw's private candidate arrays. Long-note line extraction/classification cooperates rather than running an entire native split/map before its first yield.
- Concurrency: pending full invalidation restarts discovery before publishing; callers with different folder configurations serialize their work. Regression tests exercise both cases.

## Retest measurements

| Case | Before integrated fixes | After | Verdict |
|---|---|---|---|
|100k cold target |72ms max gap,1 content read |76ms total/23ms max gap,1 read |cooperative |
|100k cold roaming |2474ms total/gap,no ticks |1940ms total,11.3ms max gap,208 ticks |fixed responsiveness |
|100k warm roaming |63ms gap |10.5ms total,8.0ms max gap,0 reads |fixed |
|100k changed-file draw |full-invalidation baseline separately retained |89–96ms total,10–13ms max gap,1 read/5 metadata lookups |bounded changed-file reads |
|250k cold target |173ms gap |213ms total,25ms max gap; warm0.05ms/0reads |cooperative |
|250k cold roaming |11327ms total/gap,no ticks |6079ms total,16.3ms max gap,621 ticks |fixed responsiveness |
|250k warm roaming |203ms gap |21.8ms total,9.1ms max gap,0 reads |fixed |
|250k changed-file draw |152–200ms gap |227–248ms total,15–19ms max gap,1 read |cooperative; total work remains linear |
|10k long-note blocks |132ms total,30ms gap |113ms total,11ms gap |fixed responsiveness |
|50k long-note blocks |549ms total,110ms gap |565ms total,11ms gap |fixed responsiveness |

The intentional throughput tradeoff is visible: some changed/long-note totals rise while their main-thread stalls fall. Cold extraction and full answer-owner initialization remain proportional to eligible notes/text; warm extraction reads only changed files. These are Bun synthetic workloads with precomputed metadata and in-memory text, not Obsidian/mobile/storage measurements. No remote model calls or real notes were used.

Behavior/work-count regression file: `keep-writing/test/round2.test.ts`; upstream pending-read tests now wait for the actual read boundary before triggering disposal/edit, rather than relying on synchronous startup timing. Final complete suite recorded below.

### Final boundary review before fix

Root identified that a full invalidation during a yielded draw filter can make the next synchronous has() rebuild ownership. Executed a2000-note mocked-clock/yield regression before changing code: one timer callback called invalidate(), and metadata reads then jumped to2000 in one uninterrupted burst (expected<1500). This is a reproduced path through folder-rename invalidation, not hypothetical. Fix will retry cooperatively before membership checks when the prepared generation becomes dirty.

## Final verification and completion

-298 tests passed;8 live-model tests skipped;0 failed. `npm run build` and `npm run lint` passed after all source changes.
- Dirty-generation regression now passes the<1500 metadata-read burst guard; its pre-fix value was2000. Seed/bookmark membership checks also prepare after asynchronous reads. Existing native list IDs remain unchanged and a reassigned Ask refuses with zero writes.
-20 successive one-file changes at250k notes each read exactly one file and five metadata entries. Retained output: `measurements/kw-round2-repeat-250k.jsonl`.
- Settled memory probe: `probes/kw-round2-memory.ts`, results `measurements/kw-round2-memory-250k.jsonl`. After explicit collection at rounds5/10/15/20, JSC heap was593.53/593.73/593.77/593.77MB; extra memory286.49/286.67/286.72/286.72MB. After disposing both caches and advancing the event loop, JSC heap fell to32.32MB with5.94MB extra (the synthetic250k-file fixture remains). This establishes a plateau and disposal for this fixture, not a small-memory device guarantee. Earlier process.memoryUsage snapshots without collection measure allocation growth and are not evidence of retained generations.
- All inventory rows have behavioral or measured retests above. No real vault, model endpoint, publication or version changes were performed by this subtask. Root owns release preparation/publication.

Harvest: retain source-association, lifetime cancellation, shared-budget, generation retry and memory-plateau lessons here and in round2 tests/probes. No additional global instruction is necessary. Cold corpus initialization and full aggregate rebuild after edits remain linear; heavy250k-note caches are an explicit memory limit. No further exploration was performed after the final review boundaries passed.

Status: done 2026-09-20.
