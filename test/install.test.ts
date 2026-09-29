// The starter Bank, written into a vault.
//
// The questions ship as NOTES rather than as data inside the plugin, because
// a source is answered when a block links to it. A question with no address
// can never be retired, and the draw would hand it back forever.

import { describe, expect, test } from 'bun:test';
import { installBank, installedLine, markInText, questionCount, shippedMark, updateBanks, updateNote } from '../src/install';
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
  // Byte for byte below the frontmatter. The one addition is the mark: the
  // highest id of each prefix that shipped, so an update knows what is new
  // and never brings back a question the owner deleted.
  test('writes the notes into the Bank folder, each with the mark of what it shipped', async () => {
    const v = fakeVault({ 'me.md': 'The self.\n' });
    const result = await installBank(v.app, 'Bank', [NOTE, SECOND]);
    expect(result).toEqual({ written: ['autoethnographic.md', 'craft.md'], skipped: [] });
    expect(v.text('Bank/autoethnographic.md')).toBe(NOTE.markdown.replace('kind: bank\n', 'kind: bank\nshipped:\n  - ae-002\n'));
    expect(v.frontmatter('Bank/autoethnographic.md')['shipped']).toEqual(['ae-002']);
    // No shipped id, no mark.
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
    const once = v.text('Bank/autoethnographic.md');
    const again = await installBank(v.app, 'Bank', [NOTE]);
    expect(again.written).toEqual([]);
    expect(v.text('Bank/autoethnographic.md')).toBe(once);
  });

  test('it honours the Bank folder setting', async () => {
    const v = fakeVault({});
    await installBank(v.app, 'Questions/keep-writing', [SECOND]);
    expect(v.text('Questions/keep-writing/craft.md')).toBe(SECOND.markdown);
  });
});

// A new round reaching someone who already installed. Before 2026-09-28 it
// reached nobody: a note already there was skipped whole. The markdown is the
// owner's, so an update only ADDS lines — never edits, moves or removes one.
describe('updateNote', () => {
  const q = (id: string, text = `question ${id}?`) => `- ${text} #register/episode ^${id}`;
  const shipped = ['---', 'kind: bank', '---', '', '## Episode', '', q('ep-001'), q('ep-002'), q('ep-003'), '', '## Fact', '', q('fa-001'), q('fa-002'), ''].join('\n');

  test('adds what shipped above the mark, each after the last line of its prefix', () => {
    const mine = ['---', 'kind: bank', '---', '', '## Episode', '', q('ep-001'), '', '## Fact', '', q('fa-001'), '', 'My own note at the end.', ''].join('\n');
    const out = updateNote(mine, ['ep-001', 'fa-001'], shipped);
    expect(out.added).toBe(3);
    expect(out.text).toBe(['---', 'kind: bank', '---', '', '## Episode', '', q('ep-001'), q('ep-002'), q('ep-003'), '', '## Fact', '', q('fa-001'), q('fa-002'), '', 'My own note at the end.', ''].join('\n'));
    expect(out.mark).toEqual(['ep-003', 'fa-002']);
  });

  test('a question the owner deleted stays deleted, and one they edited stays as they wrote it', () => {
    const mine = ['---', 'kind: bank', '---', '', q('ep-001', 'my own wording'), q('ep-003'), ''].join('\n');
    const out = updateNote(mine, ['ep-003', 'fa-002'], shipped);
    expect(out.added).toBe(0);
    expect(out.text).toBe(mine);
  });

  test('a question already in the note, wherever the owner moved it, is not added twice', () => {
    const mine = ['---', 'kind: bank', '---', '', q('ep-001'), '', '## Later', '', q('ep-003'), ''].join('\n');
    const out = updateNote(mine, ['ep-001', 'fa-002'], shipped);
    // ep-003 is where the owner put it; ep-002 lands after the last ep line.
    expect(out.text).toBe(['---', 'kind: bank', '---', '', q('ep-001'), '', '## Later', '', q('ep-003'), q('ep-002'), ''].join('\n'));
  });

  test('a prefix with nothing left in the note is added at the end', () => {
    const mine = ['---', 'kind: bank', '---', '', q('ep-003'), ''].join('\n');
    const out = updateNote(mine, ['ep-003', 'fa-001'], shipped);
    expect(out.text).toBe(['---', 'kind: bank', '---', '', q('ep-003'), q('fa-002'), ''].join('\n'));
  });

  // `autoethnographic` numbers seven registers with one prefix, `ae`. The
  // last `ae` line is in the last section, which is the wrong home for a new
  // membership question: the register finds its section.
  test('a question goes to the section of its own register when one prefix spans several', () => {
    const r = (id: string, register: string) => `- question ${id}? #register/${register} ^${id}`;
    const note = ['---', 'kind: bank', '---', '', '## Membership', '', r('ae-001', 'membership'), '', '## Structure', '', r('ae-002', 'structure'), ''];
    const out = updateNote(note.join('\n'), ['ae-002'], [...note.slice(0, -1), r('ae-003', 'membership'), ''].join('\n'));
    expect(out.text).toBe(['---', 'kind: bank', '---', '', '## Membership', '', r('ae-001', 'membership'), r('ae-003', 'membership'), '', '## Structure', '', r('ae-002', 'structure'), ''].join('\n'));
  });

  // With a mark, a prefix it does not name never shipped to this note: a
  // register a later release added. All of it is new.
  test('a register the mark has never seen is added whole', () => {
    const mine = ['---', 'kind: bank', '---', '', q('ep-003'), ''].join('\n');
    const out = updateNote(mine, ['ep-003'], shipped);
    expect(out.text).toBe(['---', 'kind: bank', '---', '', q('ep-003'), q('fa-001'), q('fa-002'), ''].join('\n'));
    expect(out.mark).toEqual(['ep-003', 'fa-002']);
  });

  // Installed before the mark existed. The highest id still in the note is
  // the best evidence of what shipped to it, and a prefix with nothing left
  // may have been emptied on purpose, so it is left alone.
  test('with no mark, what is in the note stands in for it, and an emptied prefix is left empty', () => {
    const mine = ['---', 'kind: bank', '---', '', q('ep-002'), ''].join('\n');
    const out = updateNote(mine, null, shipped);
    expect(out.text).toBe(['---', 'kind: bank', '---', '', q('ep-002'), q('ep-003'), ''].join('\n'));
    expect(out.mark).toEqual(['ep-003']);
  });

  test('the mark is read clean: anything that is not a list of prefixed ids is no mark', () => {
    expect(shippedMark(['ep-003', 'fa-010', 'junk', 7])).toEqual(new Map([['ep', 3], ['fa', 10]]));
    expect(shippedMark('ep-003')).toBeNull();
    expect(shippedMark(undefined)).toBeNull();
  });
});

// The mark is read from the note's own text, inside the write, never from the
// metadata cache: at startup the cache can still be indexing, and a note read
// as unmarked falls back to its own ids, which can offer back a question the
// owner deleted.
describe('markInText', () => {
  test('the list as Obsidian writes it, in either YAML shape', () => {
    expect(markInText('---\nkind: bank\nshipped:\n  - ae-002\n  - ep-010\n---\n\n- q? ^ae-001\n')).toEqual(['ae-002', 'ep-010']);
    expect(markInText('---\nshipped: [ae-002, "ep-010"]\nkind: bank\n---\n')).toEqual(['ae-002', 'ep-010']);
  });

  test('no frontmatter, or no mark in it, is no mark', () => {
    expect(markInText('- q? ^ae-001\n')).toBeUndefined();
    expect(markInText('---\nkind: bank\n---\n\nshipped:\n  - ae-900\n')).toBeUndefined();
  });
});

describe('updateBanks', () => {
  const V1: StarterNote = { name: 'autoethnographic.md', markdown: NOTE.markdown };
  const V2: StarterNote = { name: 'autoethnographic.md', markdown: `${NOTE.markdown}- what did your street call the corner shop? #register/membership ^ae-003\n` };

  test('an installed note gets the new questions and a new mark; nothing else is written', async () => {
    const v = fakeVault({});
    await installBank(v.app, 'Bank', [V1]);
    const result = await updateBanks(v.app, 'Bank', [V2, SECOND]);
    expect(result).toEqual([{ name: 'autoethnographic.md', added: 1 }]);
    expect(v.text('Bank/autoethnographic.md')).toContain('- what did your street call the corner shop? #register/membership ^ae-003');
    expect(v.frontmatter('Bank/autoethnographic.md')['shipped']).toEqual(['ae-003']);
    // craft.md was never installed, and an update does not install.
    expect(v.text('Bank/craft.md')).toBe('');
  });

  test('with nothing new, the note is not written at all', async () => {
    const v = fakeVault({});
    await installBank(v.app, 'Bank', [V2]);
    const writes = v.writes.length;
    expect(await updateBanks(v.app, 'Bank', [V2])).toEqual([]);
    expect(v.writes.length).toBe(writes);
  });

  test('a dry run counts and writes nothing', async () => {
    const v = fakeVault({});
    await installBank(v.app, 'Bank', [V1]);
    const writes = v.writes.length;
    expect(await updateBanks(v.app, 'Bank', [V2], { dryRun: true })).toEqual([{ name: 'autoethnographic.md', added: 1 }]);
    expect(v.writes.length).toBe(writes);
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

  test('it holds 3,576 questions, every one with an id', () => {
    expect(questionCount(STARTER_BANK)).toBe(3576);
  });

  // The registers are not one taxonomy, and the prompt rubric contradicts the
  // Bank test on purpose. 22 registers across five notes.
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
