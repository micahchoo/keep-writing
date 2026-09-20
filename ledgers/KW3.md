# KW3 — heading lookup

Status: done 2026-09-20. Started 2026-09-20. Contract: preserve nearest-heading/furniture output, reduce quadratic comparisons to n-log-n or linear; synthetic tests only. Controls: log it, don't fix it yet; continue the ledger; classify only; the kill criterion stands.

| case or stage | expected | actual and measurement | verdict | fix commit | retest |
|---|---|---|---|---|---|
| no headings / before first | empty heading | existing linear loop returns empty | preserve | no Git repository | completed below |
| nested/interleaved headings | nearest preceding heading | existing loop uses last preceding heading regardless of level | preserve | no Git repository | completed below |
| 1000 heading/block pairs | bounded comparisons | 501499 visits; uninstrumented 18.6ms extraction | quadratic | no Git repository | completed below |
| 5000 pairs | bounded comparisons | 12507499 visits; 99.1ms | quadratic | no Git repository | completed below |
| 10000 pairs | bounded comparisons | 50014999 visits; 283.4ms | quadratic | no Git repository | completed below |

Only production caller is paragraphJar; ordered Obsidian headings permit binary search. Budget: comparisons at most ceil(log2(headings+1)) per paragraph; synthetic 10k complete extraction target under 100ms, report measured outcomes rather than imply device guarantees. Inventory complete before changes.

Lesson: restart-per-item scans hide quadratic work; enforce operation-count budgets. Stored here and in tests.

## Fix and retest

headingAbove now binary-searches ordered headings. Per-file extraction obtains metadata once and caches eligibility. Profiling the remaining full extraction identified repeated proseOf normalization (isFurniture then readsAsParagraph); readsAsParagraph now normalizes once while preserving the same heading/field/floor rules. Long extraction loops cooperate with the event loop.

| case or stage | expected | actual and measurement | verdict | fix commit | retest |
|---|---|---|---|---|---|
| no headings / before first | empty | unchanged | pass | working files; no Git | extraction-cache.test.ts |
| nested / interleaved | nearest previous, independent of level | unchanged, including exact heading line | pass | working files; no Git | extraction-cache.test.ts + furniture suite |
| 1000 blocks | n-log-n comparisons | 9977 visits; uninstrumented 13.5ms | fixed/pass | working files; no Git | /tmp/kw-scale-after.ts; /tmp/kw-scale-uninstrumented.ts |
| 5000 blocks | n-log-n comparisons | 61809 visits; uninstrumented 50.4ms | fixed/pass | working files; no Git | same probes |
| 10000 blocks | <=140000 comparisons; synthetic extraction <100ms target | 133617 visits (was 50014999); uninstrumented 95.0ms (was 283.4ms) | fixed/pass | working files; no Git | same probes + enforced comparison test |

Timing includes all parsing/classification and cooperative yields; comparison counts were measured separately with instrumentation. Timings are observations, not portable test thresholds or device guarantees. Regression enforces <=140000 visits for 10000 lookups plus exact nearest-heading outputs. Full suite: 273 pass, 8 skip, 0 fail. Harvest: complexity lesson retained here and operation-count regression; no global rule needed.

Status: done 2026-09-20.
