/** Share a time budget across nested file operations, not one budget per short file. */
export class WorkBudget {
  private deadline = performance.now() + 8;
  private steps = 0;

  /** Yield to the renderer if this slice is spent, then start the next. */
  async checkpoint(): Promise<void> {
    if (performance.now() < this.deadline) return;
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    this.deadline = performance.now() + 8;
  }

  /**
   * One unit of work done. Looks at the clock every 128th, which is the
   * throttle fifteen call sites used to spell out for themselves.
   */
  async step(): Promise<void> {
    if (++this.steps % 128 === 0) await this.checkpoint();
  }
}
