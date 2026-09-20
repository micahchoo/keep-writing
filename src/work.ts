/** Share a time budget across nested file operations, not one budget per short file. */
export class WorkBudget {
  private deadline = performance.now() + 8;

  async checkpoint(): Promise<void> {
    if (performance.now() < this.deadline) return;
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    this.deadline = performance.now() + 8;
  }
}
