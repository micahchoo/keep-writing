// The loop: answer a question, mark it done, take a follow-up. Demo vault only.
(() => {
  const K = window.__kw;
  const ANSWER = 'I said I would call from the station, and I meant it when I said it. The phone box outside was out of order and by the time I found another one it was late enough that ringing would have been its own kind of rudeness. That is the whole of it. Not a decision, just a series of small reasonable delays that added up to never.';
  K.run('loop', async () => {
    const path = 'Sittings/2026-09-25.md';
    const old = app.vault.getAbstractFileByPath(path);
    if (old) await app.vault.delete(old);
    const body = '## Asked\n\n> [!ask] what was the last thing you said before a door closed for good?\n> from [[Bank/autobiographical#^ep-003]]\n\n\n';
    const file = await app.vault.create(path, body);
    await app.workspace.getLeaf(false).openFile(file);
    await K.sleep(900);
    const ed = K.editor();
    ed.setCursor({ line: 5, ch: 0 });
    ed.focus();
    await K.frame('loop-01', 1.6);
    // Typed in chunks of words, so the answer is seen being written.
    const words = ANSWER.split(' ');
    const step = Math.ceil(words.length / 7);
    for (let i = step, n = 2; i < words.length + step; i += step, n++) {
      const text = words.slice(0, Math.min(i, words.length)).join(' ');
      ed.setLine(5, text);
      ed.setCursor({ line: 5, ch: text.length });
      await K.frame(`loop-${String(n).padStart(2, '0')}`, i >= words.length ? 1.4 : 0.35);
    }
    // Obsidian saves the editor about 2 s after the last keystroke, and marking
    // reads the saved note. A person pauses; so does this.
    await K.sleep(3000);
    K.rightClick();
    await K.until(() => K.menus().length > 0, 3000);
    const sub = await K.openSubmenu();
    K.hover('Mark this answer done, and follow up');
    await K.frame('loop-20', 2.6);
    K.item(sub, 'Mark this answer done, and follow up').click();
    await K.until(() => document.querySelector('.notice'), 5000).catch(() => null);
    await K.sleep(700);
    await K.frame('loop-21', 1.8);
    await K.until(() => document.querySelectorAll('.prompt .suggestion-item').length > 0, 120000);
    await K.sleep(300);
    await K.frame('loop-22', 3.2);
    document.querySelector('.prompt .suggestion-item').click();
    await K.until(() => !document.querySelector('.prompt'), 5000);
    await K.sleep(900);
    await K.frame('loop-23', 3.6);
  });
})();
