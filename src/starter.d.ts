// The starter Bank ships as real markdown, bundled into main.js at build time
// (esbuild.config.mjs, `loader: { '.md': 'text' }`).
//
// Real markdown rather than a generated TypeScript blob: a Bank note IS a
// markdown note, so the file in `starter/` is the thing that gets written into
// the vault, byte for byte. Nothing parses it, nothing regenerates it, and it
// reads and diffs as what it is.
declare module '*.md' {
  const contents: string;
  export default contents;
}
