// Smoke: the pure parsers against the real Bank and Lens notes in this vault.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { appendAsk, parseAsks } from '../src/asks';
import { parseBankLine, parseDue } from '../src/bank';
import { bodyOf } from '../src/lens';

const VAULT = `${import.meta.dir}/../../../..`;
const items = (name: string) =>
  readFileSync(`${VAULT}/Bank/${name}.md`, 'utf8').split('\n').filter((l) => l.startsWith('- '));

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

describe('crafted banks parse', () => {
  test('closing: four bookmarks', () => {
    const parsed = items('closing').map(parseBankLine);
    expect(parsed.length).toBe(8);
    expect(parsed.filter((p) => p.role === 'bookmark').length).toBe(4);
  });
  test('imported bank: a suffixed id line parses and keeps its text clean', () => {
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
