# 0.6.0

- Paragraphs without a block id are drawn. Until now only a paragraph that already carried an id could be, so a vault without them got no questions from its own writing. Nothing is written into the paragraph: it is linked by an address computed from its words (`^kw-…`), and answering it retires it like any other.
- **Ask about the selection** no longer adds a block id to the paragraph you selected.
- Every question from your writing now has the paragraph it came from quoted under it, as text. A drawn paragraph was not shown before, and a chosen one was embedded.
- When a draw finds nothing, it says why: nothing in the folders you chose and the bank, or everything answered.
- Settings → **The AI's instructions**: who is asking, and where the AI looks when you mark an answer, point at a paragraph, or draw one. Each box holds the whole list it steers by, up to 250 words, with a **Restore** row to put the default back. The reply format stays fixed. An instruction you edited in 0.5.0 keeps working: the list it was added to is put in front of it.

Requires Obsidian 1.13.0 or later.

# 0.5.0

- 1,202 new questions: 767 in autobiographical, 60 in learning, and 375 prompts in invention. The bundled banks now hold 3,576.
- Banks you already installed can receive them. The first time Obsidian loads this version, it shows how many new questions each installed bank would gain and adds nothing unless you agree. **Add new questions to installed banks**, and **Add new questions** in settings, do the same at any time. New questions go into the section of their register. Nothing you wrote or changed is edited, and a question you deleted does not come back.
- Each bank note now carries a `shipped` property: the highest question number of each kind it has received. It is how an update knows what is new. Leave it in place.
- Settings → **What the AI looks for** holds two instructions you can edit, up to 100 words each: one for questions about a paragraph you choose, one for questions drawn from your older writing. Clear a box to restore the default. Notes in a `Lenses` folder are no longer read.
- Follow-ups can be asked for again: marking an answer again usually finds other questions, and **Different questions** in the chooser leaves out every question it has already shown.
- A follow-up is now written with the questions and answers that led to it in the same thread. Questions about a paragraph you point at have their own instructions to the model, instead of borrowing the follow-up's.

Requires Obsidian 1.13.0 or later. Existing bank notes are kept as they are until you choose to add the new questions.

# 0.4.0

- The bank list starts closed behind **Installed banks**, with a count. Open that page to adjust frequencies or open a bank note.
- Rewrote settings descriptions to explain what each control changes. Opening a bank note now closes Settings so the note is visible.
- Added 100 ordinary-life questions, reviewed against the personal Bank test. Short, particular answers are welcome; no project is needed.
- Settings now let you choose bundled banks, copy agent instructions for a new bank, and set draw weights per bank. Imported Markdown banks appear automatically. Weights apply to both opening questions and manual draws; 0 pauses a bank.
- The default bank mix is ordinary life 30, autobiographical 25, autoethnographic 20, learning 15, and invention 10. Custom banks start at 10. Empty and fully answered banks yield their share to the others.
- The folder dropdowns in settings list every folder in the vault, including folders made or renamed while Obsidian is open. In 0.3.0 they offered only the folder already chosen, and no **Add a folder** list, until the plugin was reloaded.
- The default model name is now `qwen3.8-27b`. Existing configured model names are kept.

Requires Obsidian 1.13.0 or later. Existing bank notes are preserved; install the ordinary-life bank from settings.

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
