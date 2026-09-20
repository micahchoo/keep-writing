# 0.2.7

- Reuse an incremental file index across draws, with debounced updates.
- Reopen the latest saved follow-up offer without recomposing, including after a restart.
- Migrate API keys to Obsidian secret storage and remove plaintext keys from plugin settings after successful migration.
- Unmark an answer without deleting its prose or block ID. Remove its answer relationship and matching bookmark while preserving unrelated links.
- Set the bank/paragraph draw mix in settings; the default remains 70% bank.
- Add the official Obsidian linter to the release checks.

Requires Obsidian 1.13.0 or later. Mobile behavior has not been manually verified for this release.
