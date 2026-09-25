// The graduation form: which threads leave, and what each Piece is called.
//
// Two steps. The first lists the Sitting's threads and the owner ticks the ones
// to graduate; a Sitting with one thread skips it. The second names each Piece:
// a title, the model's three lines on what the thread is about to name it by,
// the folder, and — only when the owner ticks "Suggest headings" — one heading
// field per section. Unticked, every heading is its question and the heading
// job is never called.
//
// It decides nothing about the vault. What a thread is, what graduating writes
// and every refusal are the Interview's; this holds the owner's choices until
// they press Graduate or Escape. A refusal keeps the form open so a taken title
// can be changed without starting again.

import { Modal, Notice, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type { PieceChoice } from './graduation';
import type { Graduation } from './interview';
import type { Composed } from './model';
import { modelFailureLine, refusalLine } from './refusal';
import type { Thread } from './threads';

export interface GraduateForm {
  graduation: Graduation;
  /** What the owner called the day, or empty: the title a lone thread starts with. */
  dayName: string;
  modelAvailable: boolean;
  summarize(thread: Thread): Promise<Composed<string>>;
  suggestHeadings(thread: Thread): Promise<Composed<string>>;
  /** Make the Pieces. Throws a Refusal to keep the form open. */
  graduate(choices: PieceChoice[]): Promise<void>;
}

interface Draft {
  thread: Thread;
  title: string;
  folder: string;
  /** Null while the owner has not asked for headings: every heading is its question. */
  headings: string[] | null;
}

export class GraduateModal extends Modal {
  private ticked: boolean[];
  private drafts: Draft[] = [];
  private writing = false;

  constructor(app: App, private form: GraduateForm) {
    super(app);
    this.ticked = form.graduation.threads.map(() => form.graduation.threads.length === 1);
  }

  override onOpen(): void {
    if (this.form.graduation.threads.length === 1) this.nameStep();
    else this.threadStep();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private threadStep(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText('Which threads become pieces?');
    contentEl.createEl('p', { text: 'Each one you tick becomes its own piece. The rest stay in the daily note.', cls: 'setting-item-description' });
    this.form.graduation.threads.forEach((thread, i) => {
      const [root, ...followUps] = thread.asks;
      new Setting(contentEl)
        .setName(root?.question ?? '')
        .setDesc(followUps.length === 0 ? 'No follow-ups' : followUps.length === 1 ? '1 follow-up' : `${followUps.length} follow-ups`)
        .addToggle((t) => t.setValue(this.ticked[i] ?? false).onChange((on) => {
          this.ticked[i] = on;
          refresh();
        }));
    });
    let button: { setDisabled(off: boolean): unknown } | null = null;
    new Setting(contentEl).addButton((b) => {
      button = b;
      b.setButtonText('Next').setCta().onClick(() => this.nameStep());
    });
    const refresh = () => button?.setDisabled(!this.ticked.some(Boolean));
    refresh();
  }

  private nameStep(): void {
    const { contentEl } = this;
    const { graduation } = this.form;
    contentEl.empty();
    this.titleEl.setText('Name each piece');
    const lone = this.ticked.filter(Boolean).length === 1;
    this.drafts = graduation.threads
      .filter((_, i) => this.ticked[i])
      .map((thread) => ({ thread, title: lone ? this.form.dayName : '', folder: graduation.folders[0] ?? '', headings: null }));

    for (const draft of this.drafts) {
      const block = contentEl.createDiv({ cls: 'kw-piece' });
      block.createEl('h4', { text: draft.thread.asks[0]?.question ?? '' });
      new Setting(block).setName('Title').addText((t) => t.setPlaceholder('What is this piece called?').setValue(draft.title).onChange((v) => { draft.title = v; }));
      if (this.form.modelAvailable) this.summary(block, draft.thread);
      if (graduation.folders.length > 1) {
        new Setting(block).setName('Folder').addDropdown((d) => {
          for (const f of graduation.folders) d.addOption(f, f);
          d.setValue(draft.folder).onChange((v) => { draft.folder = v; });
        });
      }
      if (this.form.modelAvailable) {
        const toggle = new Setting(block).setName('Suggest headings').setDesc('Off, each heading is its question.');
        const sections = block.createDiv();
        toggle.addToggle((t) => t.onChange((on) => {
          draft.headings = on ? draft.thread.asks.map((a) => a.question) : null;
          sections.empty();
          if (on) this.headings(sections, draft);
        }));
      }
    }

    new Setting(contentEl)
      .addButton((b) => b.setButtonText('Graduate').setCta().onClick(() => void this.submit()));
  }

  /** The three lines, once the model has read the thread. Never written anywhere. */
  private summary(block: HTMLElement, thread: Thread): void {
    const el = block.createDiv({ cls: 'kw-summary', text: 'Reading what you wrote…' });
    void this.form.summarize(thread).then((composed) => {
      el.empty();
      for (const line of summaryLines(composed)) el.createDiv({ text: line });
    });
  }

  /** One field per section, filled with the model's heading once it arrives, unless the owner typed first. */
  private headings(el: HTMLElement, draft: Draft): void {
    const fields: { setValue(v: string): unknown }[] = [];
    const typed = new Set<number>();
    draft.thread.asks.forEach((ask, i) => {
      new Setting(el).setDesc(ask.question).addText((t) => {
        fields.push(t);
        t.setValue(ask.question).onChange((v) => {
          typed.add(i);
          if (draft.headings) draft.headings[i] = v;
        });
      }).addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip('Use the question').onClick(() => {
        fields[i]?.setValue(ask.question);
        if (draft.headings) draft.headings[i] = ask.question;
      }));
    });
    void this.form.suggestHeadings(draft.thread).then(({ questions: suggested, error }) => {
      if (!draft.headings) return;
      if (!suggested.length) {
        if (error) new Notice(modelFailureLine(error));
        return;
      }
      suggested.forEach((h, i) => {
        if (typed.has(i) || !draft.headings) return;
        draft.headings[i] = h;
        fields[i]?.setValue(h);
      });
    });
  }

  private async submit(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      await this.form.graduate(this.drafts.map((d) => {
        const choice: PieceChoice = { thread: d.thread, title: d.title, folder: d.folder };
        if (d.headings) choice.headings = d.headings;
        return choice;
      }));
      this.close();
    } catch (e) {
      new Notice(refusalLine(e));
    } finally {
      this.writing = false;
    }
  }
}

/** Pure: what shows under a title field once the summary job returns. Never nothing. */
export function summaryLines({ questions: lines, error }: Composed<string>): string[] {
  if (lines.length) return lines;
  return [error ? modelFailureLine(error) : 'The model had nothing to say about this thread.'];
}
