# Question banks recording

Recorded on 2026-09-26 in `kw-testing-vault`, using the installed 0.4.0 build.
The clip contains only demo content.

`docs/img/banks.gif` shows the compact settings page, the Installed banks subpage, a frequency change, and the native Back control.
The autobiographical bank changes from 25 to 50. Back returns to the compact page.
The clip contains 52 frames at 4 frames per second, with a duration of 13 seconds.
Its dimensions are 840 × 710 pixels.

Tools: Obsidian 1.13.7 through Flatpak, ffmpeg 8.0.1, and ImageMagick 7.1.2-18.
The settings window uses a separate Electron window.
CDP `Target.attachToTarget` and `Target.sendMessageToTarget` direct pointer and keyboard input to that window.
A pointer listener reported `isTrusted: true`.
The CLI captured the settings window through `webContents.capturePage()`.
Tooltip removal changed only temporary `.tooltip` elements before capture.

In this installed version, the vault argument must precede the command:

```sh
flatpak run --no-documents-portal md.obsidian.Obsidian vault=kw-testing-vault eval 'code=app.vault.getName()'
```

Putting the command first caused some calls to use the active real vault instead.
The capture procedure checked the vault name before test writes.

The installed 0.4.0 build passed these checks:

- The main page showed one Installed banks row with the correct count of four banks.
- No bank-specific sliders appeared on the main page.
- A trusted click opened the native Installed banks subpage with all four frequency controls.
- Changing autobiographical from 25 to 50 updated its displayed share from 36% to 53%.
- The value of 50 persisted after plugin reload.
- Native Back returned to the compact page and restored its scroll position.

The earlier bank workflow passed these checks before the subpage change:

- The chooser installed only `Bank/ordinary-life.md`.
- The supplied bank frequencies showed 30, 25, 20, 15, and 10.
- A change to 60 persisted after plugin reload.
- The authoring dialog showed the complete instructions with the correct note path.
- The empty scaffold contained no indexed list items. Its example stayed inside a code fence.
- A new custom bank appeared in settings without reopening the tab, with a frequency of 10.
- A frequency of 0 showed “Paused” and persisted in settings.
- The open-note control selected the correct workspace note.

The first check found that Settings stayed in front after opening a note. Public `revealLeaf` and window `focus()` calls did not resolve this.
The final build uses a guarded Settings close call before revealing the note. A trusted click then closed Settings and brought the correct bank note forward. The same helper handles new bank notes.

Clipboard checks were inconclusive in the separate Flatpak window.
The trusted copy click showed a success notice, but a later read returned the previous clipboard text.
Manual Ctrl+A/C input had the same result.
A direct clipboard API write and read succeeded.
These results do not establish which layer caused the difference. The final copy action also selects the instructions, so they remain available for manual copying.

The earlier procedure restored the demo settings and clipboard, and moved its three temporary notes to trash.
The 0.4.0 procedure created no notes. It restored the demo settings and closed the demo Settings window.
No new vault files remained after either procedure.
All four captured states and the contact sheet were reviewed before acceptance.
Mobile behavior was not checked.
