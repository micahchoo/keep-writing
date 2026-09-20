# 0.2.8

- Preserve the selected source across delayed acceptance. Refuse changed or ambiguous paragraphs without writing to unrelated prose.
- Revalidate answers before marking them when text changes during an asynchronous operation.
- Scope targeted draws before deduplication and reuse unchanged extraction. Keep cache invalidation and disposal tied to the current file generation.
- Yield during large draws and replace repeated heading scans with indexed lookup.
- Preserve the saved follow-ups, secret storage, safe unmarking and bank-share controls from 0.2.7.
- Verify package, lockfile, manifest and tag versions before publication.

Requires Obsidian 1.13.0 or later. Synthetic large-vault checks do not establish mobile or device-specific performance.
