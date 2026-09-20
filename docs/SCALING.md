# 0.2.8 correctness and scaling checks

On2026-09-20,298 tests passed and8 live-model tests were skipped. Lint and the production build passed. The release preserves the published0.2.7 secret storage, saved follow-ups, unmark and draw settings.

Tests cover changes to a captured answer, its Ask question and its source relationship; ambiguous sources; cache invalidation and unload; and full index invalidation during a yielded draw. Refusals preserve the note body.

At250k synthetic notes, a cold roaming draw fell from11.33s without timer callbacks to6.08s total with a16ms maximum timer gap. Warm draws fell from203ms to22ms with zero content reads. Each changed-file draw reads one file; aggregate rebuilds still take roughly230ms while yielding. A50k-block note yields with about11ms maximum timer gaps.

Twenty edit/draw rounds showed a stable post-collection JSC heap around594MB plus287MB extra memory. Disposal dropped those values to32MB and6MB while the synthetic file fixture remained. Large caches still require substantial memory. These synthetic results exclude real filesystem, Obsidian and model latency; mobile performance is unverified.

Run portable probes from this directory:

```sh
bun --preload ./test/setup.ts scripts/probe-scale.ts 250000
bun --preload ./test/setup.ts scripts/probe-memory.ts 250000
```

Detailed evidence: `ledgers/ROUND2-KW.md`.
