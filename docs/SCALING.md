# Draw scaling

A draw keeps nothing between runs. It lists block ids and `answers` links from
Obsidian's metadata cache, chooses, and reads only the notes it chose. The
plugin registers no listener on ordinary notes; the one event it answers is
the creation of a Sitting.

Measured 2026-09-24 over synthetic vaults of one paragraph per note:

| notes | cold draw of three | notes read |
| --- | --- | --- |
| 20,000 | 5 ms | 3 |
| 250,000 | 58 ms | 3 |

The same 250,000-note draw took 6.08 s in 0.2.8, and an index then rebuilt the
jars 250 ms after every save of every note to keep later draws warm. The draw is
now one synchronous pass over the metadata cache, so 58 ms is also the longest
the interface waits. These figures exclude Obsidian itself, the filesystem and
the model; mobile is unmeasured.

```sh
bun --preload ./test/setup.ts scripts/probe-scale.ts 250000
```

Earlier evidence, for the index this replaced: `ledgers/ROUND2-KW.md`.
