// Shared helpers for recording keep-writing in the demo vault. Runs inside Obsidian.
(() => {
  const r = window.require('@electron/remote');
  const fs = window.require('fs');
  const DIR = '/mnt/Ghar/2TA/DevStuff/notebook/.kw-capture';
  const K = (window.__kw = { frames: [], state: 'idle', log: [] });
  K.sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  K.frame = async (name, seconds) => {
    await K.sleep(120);
    const img = await r.getCurrentWebContents().capturePage();
    fs.writeFileSync(`${DIR}/${name}.png`, img.toPNG());
    K.frames.push({ name, seconds });
  };
  K.until = async (test, ms = 90000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = test(); if (v) return v; await K.sleep(200); }
    throw new Error('timed out waiting');
  };
  K.editor = () => app.workspace.activeEditor.editor;
  K.rightClick = () => {
    const ed = K.editor(); const cm = ed.cm;
    const c = cm.coordsAtPos(cm.state.selection.main.head);
    const ref = app.workspace.on('editor-menu', (m) => { K.menu = m; });
    cm.contentDOM.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: c.left + 4, clientY: c.top + 8 }));
    app.workspace.offref(ref);
  };
  K.menus = () => [...document.querySelectorAll('.menu')];
  K.item = (menu, title) => [...menu.querySelectorAll('.menu-item')].find((i) => i.querySelector('.menu-item-title')?.textContent === title);
  // What Obsidian's own pointer handling calls: open the submenu, return it.
  K.openSubmenu = async (title = 'keep-writing') => {
    const item = K.menu.items.find((i) => i.titleEl && i.titleEl.textContent === title);
    K.menu.select(K.menu.items.indexOf(item));
    K.menu.openSubmenu(item);
    await K.until(() => K.menus().length > 1, 3000);
    K.sub = item.submenu;
    return K.menus()[1];
  };
  K.hover = (title) => {
    const i = K.sub.items.findIndex((x) => x.titleEl && x.titleEl.textContent === title);
    K.sub.select(i);
  };
  K.write = (name, data) => fs.writeFileSync(`${DIR}/${name}`, data);
  K.run = (name, fn) => {
    K.state = 'running';
    fn().then(() => { K.write(`${name}.json`, JSON.stringify(K.frames, null, 1)); K.state = 'done'; })
      .catch((e) => { K.state = 'ERR ' + e.message; });
  };
})();
