// The starter Bank, written into a vault.
//
// The questions ship as NOTES rather than as data inside the plugin, because
// a source is answered when a block links to it. A question with no address
// can never be retired, and the draw would hand it back forever.

import { describe, expect, test } from 'bun:test';
import { installBank, installedLine, questionCount } from '../src/install';
import type { StarterNote } from '../src/install';
import { STARTER_BANK } from '../src/starter-bank';
import { fakeVault } from './fake-vault';

const NOTE: StarterNote = {
  name: 'autoethnographic.md',
  markdown: '---\nkind: bank\n---\n\n## Membership\n\n- what did your family do? #register/membership ^ae-001\n- what word did you use at home? #register/membership ^ae-002\n',
};
const SECOND: StarterNote = {
  name: 'craft.md',
  markdown: '---\nkind: bank\n---\n\n- what did you make this week? #register/episode ^x1\n',
};

describe('installBank', () => {
  test('writes the notes, byte for byte, into the Bank folder', async () => {
    const v = fakeVault({ 'me.md': 'The self.\n' });
    const result = await installBank(v.app, 'Bank', [NOTE, SECOND]);
    expect(result).toEqual({ written: ['autoethnographic.md', 'craft.md'], skipped: [] });
    expect(v.text('Bank/autoethnographic.md')).toBe(NOTE.markdown);
    expect(v.text('Bank/craft.md')).toBe(SECOND.markdown);
  });

  // A migration, not a sync. The moment the owner can edit a Bank note in
  // Obsidian, the markdown is the source of truth — the same rule
  // `.bin/import-bank.py` enforces by refusing without `--force`.
  test('a note already there is skipped and not read', async () => {
    const mine = '---\nkind: bank\n---\n\n- my own question? #register/value ^m1\n';
    const v = fakeVault({ 'Bank/autoethnographic.md': mine });
    const result = await installBank(v.app, 'Bank', [NOTE, SECOND]);
    expect(result).toEqual({ written: ['craft.md'], skipped: ['autoethnographic.md'] });
    expect(v.text('Bank/autoethnographic.md')).toBe(mine);
  });

  test('running it twice is the same as running it once', async () => {
    const v = fakeVault({});
    await installBank(v.app, 'Bank', [NOTE]);
    const again = await installBank(v.app, 'Bank', [NOTE]);
    expect(again.written).toEqual([]);
    expect(v.text('Bank/autoethnographic.md')).toBe(NOTE.markdown);
  });

  test('it honours the Bank folder setting', async () => {
    const v = fakeVault({});
    await installBank(v.app, 'Questions/keep-writing', [SECOND]);
    expect(v.text('Questions/keep-writing/craft.md')).toBe(SECOND.markdown);
  });
});

describe('questionCount', () => {
  test('counts list items that carry a block id, and nothing else', () => {
    expect(questionCount([NOTE, SECOND])).toBe(3);
    expect(questionCount([{ name: 'x.md', markdown: '---\nkind: bank\n---\n\nProse, a heading, no entries.\n' }])).toBe(0);
  });
});

describe('installedLine', () => {
  test('says what happened, in the owner’s own folder name', () => {
    expect(installedLine({ written: ['a.md'], skipped: [] }, 'Bank')).toBe('Wrote 1 question note to Bank.');
    expect(installedLine({ written: ['a.md', 'b.md'], skipped: ['c.md'] }, 'Bank')).toBe(
      'Wrote 2 question notes to Bank, and left 1 already there.',
    );
    expect(installedLine({ written: [], skipped: ['a.md'] }, 'Q')).toBe('The question bank is already in Q.');
  });
});

// What actually ships. These assertions are the release check: a bank note the
// plugin cannot read is a plugin that draws nothing on the day it is installed.
describe('the shipped bank', () => {
  test('every note is a bank note the plugin can read', () => {
    expect(STARTER_BANK.length).toBeGreaterThan(0);
    for (const note of STARTER_BANK) {
      expect(note.name).toMatch(/\.md$/);
      expect(note.markdown).toMatch(/^---\n[\s\S]*?\nkind: bank\n[\s\S]*?---/);
    }
  });

  test('it holds 2,274 questions, every one with an id', () => {
    expect(questionCount(STARTER_BANK)).toBe(2274);
  });

  // The registers are not one taxonomy, and the prompt rubric contradicts the
  // Bank test on purpose. 22 registers across four notes.
  //
  // The floor is 40, not 100, because the 2026-09-17 judge pass was not even:
  // `belief` lost 52 of 100 and `invention` 49 of 100, while `fact` lost
  // nothing. A register that thin is a register written wrong, and the number
  // is left honest here rather than topped up.
  test('every register the canon names is stocked', () => {
    const counts = new Map<string, number>();
    for (const note of STARTER_BANK) {
      for (const [, r] of note.markdown.matchAll(/#register\/([a-z-]+)/g)) {
        counts.set(r as string, (counts.get(r as string) ?? 0) + 1);
      }
    }
    for (const register of [
      'episode', 'general-event', 'lifetime-period', 'fact', 'construct', 'intention',
      'value', 'causal-theory', 'belief', 'state', 'transformative',
      'knowledge', 'skill', 'research-spur', 'invention',
      'membership', 'positionality', 'relation', 'telling', 'embodiment', 'artifact', 'structure',
    ]) {
      expect(counts.get(register) ?? 0).toBeGreaterThan(40);
    }
    expect(counts.size).toBe(22);
  });

  test('every entry carries a register, and none carries a Role', () => {
    for (const note of STARTER_BANK) {
      for (const line of note.markdown.split('\n').filter((l) => /^\s*-\s.*\^[A-Za-z0-9-]+\s*$/.test(l))) {
        expect(line).toMatch(/#register\/[a-z-]+/);
        // A Role means a Closing move, which the template carries in. One
        // drawn from the jar would place the same Ask twice.
        expect(line).not.toMatch(/#role\//);
      }
    }
  });

  test('block ids are unique across everything that ships', () => {
    const ids = STARTER_BANK.flatMap((n) => [...n.markdown.matchAll(/\^([A-Za-z0-9-]+)\s*$/gm)].map((m) => m[1]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
