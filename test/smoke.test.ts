// Smoke: the pure parsers against real notes rather than fixtures.
//
// Two populations, and the difference decides whether a test may run. The
// STARTER bank ships inside the plugin, so it is here wherever the repo is
// and its checks always run. The notes of the vault ABOVE the plugin are one
// person's, and the plugin is published without them: every test that reads
// `VAULT` must skip when they are absent, or a fresh clone fails two tests on
// the first `bun test` anyone runs. Measured 2026-09-17 by cloning the split
// history into /tmp: 225 pass, 2 fail, both of them here.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { appendAsk, parseAsks } from '../src/asks';
import { parseBankLine, parseDue } from '../src/bank';
import { bodyOf } from '../src/lens';
import { STARTER_BANK } from '../src/starter-bank';

const VAULT = `${import.meta.dir}/../../../..`;
const bankNote = (name: string) => `${VAULT}/Bank/${name}.md`;
const items = (name: string) =>
  readFileSync(bankNote(name), 'utf8').split('\n').filter((l) => l.startsWith('- '));
/** This vault's own Bank is not published with the plugin. */
const inVault = (name: string) => existsSync(bankNote(name));

describe('the Lenses', () => {
  for (const [name, target] of [['craft', 'domain'], ['learning', 'learning']] as const) {
    test(`${name}: kind lens, for ${target}, prose after the frontmatter`, () => {
      const path = `${VAULT}/Lenses/${name}.md`;
      if (!existsSync(path)) return; // being written by another hand; the plugin reads '' until then
      const md = readFileSync(path, 'utf8');
      expect(md).toMatch(/^---\n[\s\S]*kind: lens[\s\S]*---/);
      expect(md).toMatch(new RegExp(`for: ${target}`));
      expect(bodyOf(md).length).toBeGreaterThan(100);
    });
  }
});

// What ships. These run everywhere, because the notes are in the repo.
describe('the starter bank parses', () => {
  const lines = STARTER_BANK.flatMap((n) => n.markdown.split('\n').filter((l) => l.startsWith('- ')));

  test('every shipped entry parses to text, a register and no debris', () => {
    expect(lines.length).toBe(2274);
    for (const line of lines) {
      const p = parseBankLine(line);
      expect(p.text).not.toBe('');
      expect(p.register).not.toBe('none');
      // A block id or a tag left in the text would be asked verbatim.
      expect(p.text).not.toMatch(/\^[a-z]+-\d+|#register|#role/);
      // A Role means a Closing move, which the template carries in; drawing
      // one would place the same Ask twice.
      expect(p.role).toBeNull();
    }
  });
});

// This vault's own Bank. Absent wherever the plugin is published alone.
describe.skipIf(!inVault('closing'))('crafted banks parse', () => {
  test('closing: four bookmarks', () => {
    const parsed = items('closing').map(parseBankLine);
    expect(parsed.length).toBe(8);
    expect(parsed.filter((p) => p.role === 'bookmark').length).toBe(4);
  });
});

describe.skipIf(!inVault('Questions'))('the imported bank parses', () => {
  test('a suffixed id line parses and keeps its text clean', () => {
    const line = items('Questions').find((l) => /\^b\d+-\d+$/.test(l));
    expect(line).toBeDefined();
    const p = parseBankLine(line as string);
    expect(p.register).not.toBe('none');
    expect(p.text).not.toMatch(/\^b|#register/);
  });
});

describe('due', () => {
  test('+7d from a fixed day', () => {
    expect(parseDue('+7d', new Date('2026-09-14T12:00:00Z'))).toBe('2026-09-21');
  });
});

describe('ask round trip', () => {
  test('append then answer then parse', () => {
    const t = appendAsk('---\nabout: "[[me]]"\n---\n\n## Asked\n', 'what are you no longer afraid of?', 'Bank/Questions#^b123');
    const lines = t.text.split('\n');
    lines[t.cursorLine] = 'Heights, mostly. I climbed the tower in June.';
    const [ask] = parseAsks(lines.join('\n'));
    expect(ask?.question).toBe('what are you no longer afraid of?');
    expect(ask?.sourceRef).toBe('Bank/Questions#^b123');
    expect(ask?.firstParagraph?.start).toBe(t.cursorLine);
  });
});
