# 0.2.9

- Accepting a saved follow-up no longer writes the paragraph's block id a second time when it already has one. The one body edit the plugin makes is now covered by tests that drive the writer that ships; until now they drove a twin nothing called.
- The saved follow-ups (the ones **Reopen latest follow-ups** shows) keep their rules in one place: a question leaves the offer only once its Ask is written, two clicks write once, and an offer replaced by a newer one accepts nothing. Same behaviour, now tested.
- Internal: answered-ness and the jar cache move out of the Bank module; what a reach decides (Lens, composer, embedding) is one table; the bank share default and its clamp are declared once; unmark reads the property names from the modules that own them; the cooperative work budget counts its own steps.

Requires Obsidian 1.13.0 or later. No change to stored data or settings.

# 0.2.8

- Preserve the selected source across delayed acceptance. Refuse changed or ambiguous paragraphs without writing to unrelated prose.
- Revalidate answers before marking them when text changes during an asynchronous operation.
- Scope targeted draws before deduplication and reuse unchanged extraction. Keep cache invalidation and disposal tied to the current file generation.
- Yield during large draws and replace repeated heading scans with indexed lookup.
- Preserve the saved follow-ups, secret storage, safe unmarking and bank-share controls from 0.2.7.
- Verify package, lockfile, manifest and tag versions before publication.

Requires Obsidian 1.13.0 or later. Synthetic large-vault checks do not establish mobile or device-specific performance.
