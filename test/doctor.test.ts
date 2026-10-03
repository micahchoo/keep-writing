import { describe, expect, test } from 'bun:test';
import { loadBank } from '../src/bank';
import { doctorLine, runDoctor, skippedLines } from '../src/doctor';
import { virtualId } from '../src/refs';
import { fakeVault, mulberry32 } from './fake-vault';

// The Doctor (CONTEXT.md): pressed by the owner, it repairs what has one right
// answer and lists the rest. No undo, so every repair here is one a test can
// show to be the only reading.

const BANK = '---\nkind: bank\n---\n';
const doctor = (v: ReturnType<typeof fakeVault>, weights = {}) => runDoctor(v.app, 'Bank', weights, mulberry32(1));

describe('a line with no id outside the Custom bank', () => {
  test('is given one, and becomes a question; the Custom bank is never given one', async () => {
    const custom = `${BANK}- my own, with no id?\n`;
    const v = fakeVault({
      'Bank/travel.md': `${BANK}- where did you get lost? ^t1\n- what did you carry home?\n- and what did you leave?\n`,
      'Bank/Custom.md': custom,
    });
    const report = await doctor(v);
    expect(v.text('Bank/Custom.md')).toBe(custom);
    const lines = v.text('Bank/travel.md').trimEnd().split('\n');
    expect(lines[3]).toMatch(/^- where did you get lost\? \^t1$/);
    expect(lines[4]).toMatch(/^- what did you carry home\? \^[a-z0-9]{6}$/);
    expect(lines[5]).toMatch(/^- and what did you leave\? \^[a-z0-9]{6}$/);
    expect(lines[4]?.slice(-6)).not.toBe(lines[5]?.slice(-6));
    expect((await loadBank(v.app, v.file('Bank/travel.md'), 'Bank')).map((q) => q.text)).toHaveLength(3);
    expect(report.ids).toEqual({ 'Bank/travel.md': 2 });
    expect(report.needs).toEqual([]);
  });

  test('that already has an answer is listed, not written: it is a renamed Custom bank', async () => {
    const mine = `${BANK}- what did my father never say?\n`;
    const v = fakeVault({
      'Bank/Mine.md': mine,
      'Sittings/2026-10-01.md': `---\nanswers:\n- "[[Bank/Mine#^${virtualId('what did my father never say?')}]]"\n---\n\nNothing. ^a1\n`,
    });
    const report = await doctor(v);
    expect(v.text('Bank/Mine.md')).toBe(mine);
    expect(report.needs.map((n) => n.path)).toEqual(['Bank/Mine.md']);
  });
});

describe('one id on two lines of one note', () => {
  test('unanswered: the first keeps it, the later line gets a new one', async () => {
    const v = fakeVault({ 'Bank/craft.md': `${BANK}- one? ^b1\n- two? ^b1\n` });
    await doctor(v);
    const lines = v.text('Bank/craft.md').trimEnd().split('\n');
    expect(lines[3]).toBe('- one? ^b1');
    expect(lines[4]).toMatch(/^- two\? \^[a-z0-9]{6}$/);
  });

  test('answered: an answer cannot say which line it meant, so both are listed', async () => {
    const before = `${BANK}- one? ^b1\n- two? ^b1\n`;
    const v = fakeVault({
      'Bank/craft.md': before,
      'Sittings/2026-10-01.md': '---\nanswers:\n- "[[Bank/craft#^b1]]"\n---\n\nYes. ^a1\n',
    });
    const report = await doctor(v);
    expect(v.text('Bank/craft.md')).toBe(before);
    expect(report.needs).toHaveLength(1);
  });

  test('in a Starter Bank note it is listed: its ids are addresses other vaults hold', async () => {
    const before = '---\nkind: bank\nshipped: [b9]\n---\n- one? ^b1\n- two? ^b1\n';
    const v = fakeVault({ 'Bank/learning.md': before });
    const report = await doctor(v);
    expect(v.text('Bank/learning.md')).toBe(before);
    expect(report.needs).toHaveLength(1);
  });
});

describe('an answer to a Custom question whose words changed', () => {
  const OLD = 'what did my father never say out loud?';
  const NEW = 'what did my father never say out loud, even once?';
  const answer = (old: string) =>
    `---\nanswers:\n- "[[Bank/Custom#^${virtualId(old)}]]"\n---\n\n## Asked\n\n> [!ask] ${old}\n> from [[Bank/Custom#^${virtualId(old)}]]\n\nSorry. ^a1\n`;

  test('is pointed at the one line clearly closest in words; the Sitting body is not touched', async () => {
    const v = fakeVault({
      'Bank/Custom.md': `${BANK}- ${NEW}\n- what do my hands remember?\n`,
      'Sittings/2026-10-01.md': answer(OLD),
    });
    const body = v.text('Sittings/2026-10-01.md').split('---\n').at(-1);
    const report = await doctor(v);
    const after = v.text('Sittings/2026-10-01.md');
    expect(after).toContain(`[[Bank/Custom#^${virtualId(NEW)}]]`);
    expect(after.split('---\n').at(-1)).toBe(body);
    expect(report.retargeted).toBe(1);
  });

  test('two lines equally close: listed, and the link is left as it was', async () => {
    const v = fakeVault({
      'Bank/Custom.md': `${BANK}- ${NEW}\n- what did my father never say out loud, not once?\n`,
      'Sittings/2026-10-01.md': answer(OLD),
    });
    const before = v.text('Sittings/2026-10-01.md');
    const report = await doctor(v);
    expect(v.text('Sittings/2026-10-01.md')).toBe(before);
    expect(report.retargeted).toBe(0);
    expect(report.needs.map((n) => n.path)).toEqual(['Sittings/2026-10-01.md']);
  });

  test('the Custom bank gone altogether is listed', async () => {
    const v = fakeVault({ 'Sittings/2026-10-01.md': answer(OLD) });
    const report = await doctor(v);
    expect(report.needs).toHaveLength(1);
  });
});

describe('what the Doctor only lists', () => {
  test('a bank at weight 0 is a choice, not a fault: listed, nothing written', async () => {
    const before = `${BANK}- paused? ^p1\n`;
    const v = fakeVault({ 'Bank/paused.md': before });
    const report = await doctor(v, { 'paused.md': 0 });
    expect(v.text('Bank/paused.md')).toBe(before);
    expect(report.needs.map((n) => n.path)).toEqual(['Bank/paused.md']);
  });
});

describe('what the owner is told', () => {
  test('a clean vault: nothing written, and it says so', async () => {
    const v = fakeVault({ 'Bank/craft.md': `${BANK}- one? ^b1\n` });
    expect(doctorLine(await doctor(v))).toBe('The question banks are in order.');
  });

  test('each write counted by note, and what is left for the owner', () => {
    expect(doctorLine({ ids: { 'Bank/travel.md': 12 }, retargeted: 1, needs: [{ path: 'a', line: 0, text: '', why: '' }, { path: 'b', line: 0, text: '', why: '' }] }))
      .toBe('Added 12 ids in travel. Pointed 1 answer at its edited question. 2 things need you.');
  });

  test('the lines a search skips are counted from the cache alone, Custom excepted', () => {
    const v = fakeVault({
      'Bank/travel.md': `${BANK}- one? ^t1\n- no id?\n- nor this?\n`,
      'Bank/Custom.md': `${BANK}- mine?\n`,
    });
    expect(skippedLines(v.app, 'Bank')).toBe(2);
  });
});
