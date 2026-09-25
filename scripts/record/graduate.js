// Graduation: a thread of the demo Sitting becomes a piece. Demo vault only.
(() => {
  const K = window.__kw;
  const row = (name) => [...document.querySelectorAll('.modal .setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name);
  K.run('graduate', async () => {
    const file = app.vault.getAbstractFileByPath('Sittings/2026-09-18.md');
    await app.workspace.getLeaf(false).openFile(file);
    await K.sleep(900);
    const ed = K.editor();
    const line = ed.getValue().split('\n').findIndex((l) => l.includes('^5vaacs'));
    ed.setCursor({ line, ch: ed.getLine(line).length });
    ed.focus();
    ed.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } });
    await K.frame('grad-01', 1.8);
    K.rightClick();
    await K.until(() => K.menus().length > 0, 3000);
    await K.openSubmenu();
    K.hover('Graduate threads to pieces');
    await K.frame('grad-02', 2.4);
    [...K.menus()[1].querySelectorAll('.menu-item')].find((i) => i.textContent.includes('Graduate')).click();
    await K.until(() => document.querySelector('.modal .kw-summary'), 5000);
    await K.frame('grad-03', 1.0);
    await K.until(() => { const t = document.querySelector('.modal .kw-summary')?.textContent ?? ''; return t && !t.startsWith('Reading'); }, 120000);
    await K.frame('grad-04', 2.4);
    const input = row('Title').querySelector('input');
    const title = 'The door handle';
    for (let i = 5; i <= title.length + 4; i += 5) {
      input.value = title.slice(0, i);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await K.sleep(80);
    }
    await K.frame('grad-05', 1.6);
    row('Suggest headings').querySelector('.checkbox-container').click();
    const questions = ['what did you save from a place that no longer exists?', 'What did the flat look like on a rainy day when the handle stuck?'];
    await K.until(() => {
      const fields = [...document.querySelectorAll('.modal .kw-piece input[type=text]')].slice(1);
      return fields.length === 2 && fields.every((f, i) => f.value && f.value !== questions[i]);
    }, 120000);
    await K.frame('grad-06', 3.4);
    [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Graduate').click();
    await K.until(() => app.workspace.getActiveFile()?.path === 'Pieces/The door handle.md', 10000);
    await K.sleep(1200);
    await K.frame('grad-07', 4.0);
  });
})();
