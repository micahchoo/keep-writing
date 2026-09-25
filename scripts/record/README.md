# Recording the README's images

Obsidian captures its own window: `@electron/remote` is reachable from the
Obsidian CLI's `eval`, and `webContents.capturePage()` returns a PNG of the
window with its menus, notices and modals. This works under Wayland, where
every outside capture route failed (see HANDOFF, 2026-09-18).

Record in `notebook/kw-testing-vault`, never in a real vault: these images are
public. The answers shown are the demo vault's own.

1. Open the demo vault (`obsidian "obsidian://open?vault=kw-testing-vault"`),
   install the build, point it at a model the server has.
2. Size the window: `getCurrentWindow().setContentSize(1100, 800)`, sidebars
   collapsed. Settings open in their OWN window; capture that one by title.
3. Load `lib.js`, then `loop.js` or `graduate.js`, with
   `(0,eval)(fs.readFileSync(path,'utf8'))` inside `eval`. Each runs async and
   sets `window.__kw.state`; poll it. The CLI prints nothing for an `eval` that
   awaits for long.
4. Each script writes its frames and `<name>.json` with the seconds each frame
   shows. Build the GIF with ffmpeg's concat demuxer from those durations,
   `crop=950:760:150:40,scale=820:-1`, and a 96-colour palette.

Paths in `lib.js` are absolute to this machine. Two traps: marking reads the
SAVED note, so wait ~3 s after typing; and asking the window manager for a
height near the screen's makes it maximize the window.
