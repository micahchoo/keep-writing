# KW2 — scoped and cached extraction

Status: done 2026-09-20. Started 2026-09-20. Contract: eligible targets survive unrelated duplicates; warm target reads depend on target size, warm roaming reads on changed files; invalidation preserves rename/delete/answer semantics. Synthetic data only. Controls: log it, don't fix it yet; continue the ledger; classify only; the kill criterion stands.

| case or stage | expected | actual and measurement | verdict | fix commit | retest |
|---|---|---|---|---|---|
| target and non-target duplicate | target remains | target z discarded for a, zero paragraphs | defect | no Git repository | completed below |
| outside configured folders | empty by recorded policy | empty; sources.test.ts80-86 | preserve | no Git repository | completed below |
| roaming dedup/answered/skipped | existing ordering and identity | existing suite passes | preserve | no Git repository | completed below |
| 10k eligible notes targeted | reads bounded by target | 10000 reads/10.93MB, 173.5/180.7ms | defect | no Git repository | completed below |
| 50k eligible notes targeted | reads bounded by target | 50000 reads/54.69MB, 909.9/876.8ms | defect | no Git repository | completed below |
| warm roaming | reuse unchanged extraction | no extraction cache; all eligible files read every time | defect | no Git repository | completed below |
| edit/metadata/rename/delete | no stale cached sources | uncached current implementation has no retained extraction state | baseline | no Git repository | completed below |

Inventory: bankNotes enumerates metadata, loadBank extracts questions, paragraphJar reads eligible notes, globally deduplicates; fillJars only then scopes target and filters answer/skip keys. Keep configured-folder and status eligibility. AnsweredIndex remains separately invalidated. Per-file cache must include in-flight entries, invalidate both old/new rename paths, discard rejected loads, and clear on unload. Timing fixtures use precomputed metadata and in-memory reads, not Obsidian device benchmarks.

Lesson: scope before lossy transforms; cache parsed file facts, not current draw eligibility. Stored here and in regression tests.

## Fix and retest

Eligible target files are scoped before extraction/deduplication; outside-folder exclusion remains. A plugin-owned per-file extraction cache shares in-flight parsing, invalidates on vault modification/deletion/rename and metadata changes/deletion, retries invalidated in-flight reads against current file paths, and clears on plugin disposal. Failed loads are evicted. Answered/skipped filtering stays outside the cache. Long corpus/block loops yield after roughly 8ms work, checked in bounded batches; final deduplication remains linear.

| case or stage | expected | actual and measurement | verdict | fix commit | retest |
|---|---|---|---|---|---|
| eligible targeted duplicate | target survives | z target returned even though a has same text | fixed/pass | working files; no Git | extraction-cache.test.ts |
| outside folder | empty | empty without read | preserved | working files; no Git | extraction-cache.test.ts + existing sources suite |
| warm roaming + bank | no unchanged reads | 0 repeated reads; skipped/answered evaluated freshly | fixed/pass | working files; no Git | extraction-cache.test.ts |
| changed text / metadata | refresh changed file only | exactly one read after each changed-file invalidation; References heading excludes block | fixed/pass | working files; no Git | extraction-cache.test.ts |
| rename / delete / in-flight rename | no obsolete paths | renamed refs use new path; deleted candidate absent; pending rename retried once under new path | fixed/pass | working files; no Git | extraction-cache.test.ts |
| unload | release extraction | dispose clears cache and future reads bypass retention | fixed/pass | working files; no Git | extraction-cache.test.ts |
| 10k targeted cold/warm | target-sized reads | 1/0 reads; 3.40/0.052ms | fixed/pass | working files; no Git | ledgers/probes/kw-responsive.ts |
| 50k targeted cold/warm | target-sized reads | 1/0 reads; 10.99/0.041ms | fixed/pass | working files; no Git | ledgers/probes/kw-responsive.ts |
| 10k roaming cold/warm | warm reads only changed files | 9999/0 reads (one target prewarmed); 157.3/13.1ms; max timer gap 17.1/8.5ms | fixed/pass | working files; no Git | ledgers/probes/kw-responsive.ts |
| 50k roaming cold/warm | warm reads only changed files | 49999/0 reads; 855.0/73.7ms; max timer gap 65.0/16.8ms | fixed/pass; cold latency limitation | working files; no Git | ledgers/probes/kw-responsive.ts |

Measurements are synthetic in-memory, precomputed metadata, ~1KB/file, excluding model and real disk/device latency. First roaming draw still scales with total corpus and retains extracted candidates in memory. The observed 65ms cold 50k timer gap exceeds the proposed general 50ms UI target; yielding improves responsiveness but does not certify arbitrary large-note/GC pauses. Warm targeted <100ms budget and changed-file read invariants pass. No mobile/Obsidian UI measurements claimed.

All inventory rows retested. Full suite: 273 pass, 8 skip, 0 fail; production build and lint run. Harvest: query-scope and invalidation lessons retained here and behavioral/count tests; no global rule added.

Status: done 2026-09-20.
