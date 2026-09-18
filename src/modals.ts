// Every offer the Interview makes is a modal: shown, chosen from, gone.
//
// One generic chooser serves all three offers — the sources a draw found, the
// questions bonsai composed about a paragraph, the Follow-ups on an answer —
// because all three are the same act: pick one of these, or press Escape.
//
// This replaced two ItemViews on 2026-09-17. A pane had to hold every offer as
// state so it could redraw it, gate every redraw on a signature so an event
// that changed nothing could not empty `contentEl` between a mousedown and a
// mouseup, and drop a model reply that landed after the owner had moved on.
// A modal holds its own offer for as long as it is open and then goes away, so
// none of those three problems exists here.

import { Modal, Setting, SuggestModal } from 'obsidian';
import type { App } from 'obsidian';

/** One row: what it says, what it is worth, and what picking it means. */
export interface Choice<T> {
  value: T;
  /** The line the owner reads. */
  title: string;
  /** The quieter line under it: a register, a date, where it was written. */
  note?: string;
}

/**
 * Pick one of these, or press Escape. Escape is the only "no" the interview
 * needs: before this, refusing a drawn source meant a `skipped` set that lived
 * as long as the pane did, because the draw handed over one source at a time.
 * Several at once makes the refusal free.
 */
export class ChoiceModal<T> extends SuggestModal<Choice<T>> {
  constructor(
    app: App,
    private choices: Choice<T>[],
    placeholder: string,
    private picked: (value: T) => void,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getSuggestions(query: string): Choice<T>[] {
    const q = query.toLowerCase().trim();
    if (!q) return this.choices;
    return this.choices.filter((c) => c.title.toLowerCase().includes(q));
  }

  /**
   * `el` IS the `.suggestion-item`, which Obsidian keeps to one ellipsised
   * line. A question is a sentence and a drawn paragraph is several, so the
   * class goes on the row itself and `styles.css` lets it wrap. Scoped to our
   * rows: every other suggester in Obsidian stays one line, as it should.
   */
  renderSuggestion(choice: Choice<T>, el: HTMLElement): void {
    el.addClass('kw-choice');
    el.createDiv({ text: choice.title, cls: 'kw-choice-title' });
    if (choice.note) el.createDiv({ text: choice.note, cls: 'kw-note' });
  }

  onChooseSuggestion(choice: Choice<T>): void {
    this.picked(choice.value);
  }
}

/**
 * An offer with a paragraph of copy and two buttons. The only thing in the
 * plugin that asks before writing, because it is the only thing that writes
 * more than one note at a time and does it into a vault that is not this
 * one's owner's.
 *
 * Closing it any other way — Escape, the X — is the "no" and runs nothing.
 */
export class OfferModal extends Modal {
  private confirmed = false;

  constructor(
    app: App,
    private copy: { title: string; body: string[]; confirm: string; dismiss: string },
    private onConfirm: () => void,
    private onDismiss: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(this.copy.title);
    for (const line of this.copy.body) this.contentEl.createEl('p', { text: line });
    new Setting(this.contentEl)
      .addButton((b) =>
        b
          .setButtonText(this.copy.confirm)
          .setCta()
          .onClick(() => {
            this.confirmed = true;
            this.close();
            this.onConfirm();
          }),
      )
      .addButton((b) => b.setButtonText(this.copy.dismiss).onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed) this.onDismiss();
  }
}

/** Show a chooser. Nothing to choose from is said once and nothing opens. */
export function choose<T>(
  app: App,
  choices: Choice<T>[],
  placeholder: string,
  picked: (value: T) => void,
): void {
  new ChoiceModal(app, choices, placeholder, picked).open();
}
