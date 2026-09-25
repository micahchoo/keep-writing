# Unreleased

- The folder dropdowns in settings list every folder in the vault, including folders made or renamed while Obsidian is open. In 0.3.0 they offered only the folder already chosen, and no **Add a folder** list, until the plugin was reloaded.

# 0.3.0

- A draw reads only the notes it chooses. Over 250,000 synthetic notes a draw takes 58 ms, where it took 6 s. The plugin no longer does work each time any note is saved.
- Marking an answer writes `answers` on the answer only. It no longer writes `answered-by` on the source, or `registers` on the answer. Properties already in your notes are not changed.
- Removed: **Reopen latest follow-ups**, **Unmark this answer** and **Open the menu**. The right-click submenu stays, and offers **Graduate threads to pieces** in a daily note. To get follow-ups again, mark the answer again. To take back a mark, delete it from `answers`.
- New: **Graduate threads to pieces**. A question and its follow-ups move out of a daily note into a new piece, word for word, with the questions as headings. Every link to a moved paragraph follows it. The model can summarize a thread to help you name it, and suggest headings when you ask; neither is written unless you pick it.
- The chooser's paragraph count includes blocks it has not read yet, so it can be higher than before. Two tellings of one paragraph are now two blocks.

Requires Obsidian 1.13.0 or later. A saved follow-up offer from 0.2.9 is dropped from plugin data on the next settings write.

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
