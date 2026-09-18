import { describe, expect, test } from 'bun:test';
import { BANK_SHARE, jarCounts, parseBankLine, parseDue, pickOne, pickFromJars } from '../src/bank';
import type { BankQuestion, Jars, WellPool } from '../src/bank';
import type { Paragraph } from '../src/paragraphs';
import type { Well } from '../src/target';
import { mulberry32, sequence } from './fake-vault';

describe('parseDue', () => {
  const today = new Date(2026, 8, 13); // local 2026-09-13
  test('+Nd is relative to today', () => {
    expect(parseDue('+7d', today)).toBe('2026-09-20');
    expect(parseDue('+30d', today)).toBe('2026-10-13');
  });
  test('absolute dates pass through', () => {
    expect(parseDue('2026-12-01', today)).toBe('2026-12-01');
  });
  test('garbage is null', () => {
    expect(parseDue('soon', today)).toBeNull();
  });
});

describe('parseBankLine', () => {
  test('splits text, register, due, role, id', () => {
    const p = parseBankLine('- state your model so far #register/knowledge due: +7d ^l3k9aa');
    expect(p).toEqual({
      text: 'state your model so far',
      register: 'knowledge',
      due: '+7d',
      role: null,
    });
    expect(parseBankLine('- where should we pick up? #register/intention #role/bookmark ^c1')).toEqual({
      text: 'where should we pick up?',
      register: 'intention',
      role: 'bookmark',
    });
  });
});

describe('pickOne', () => {
  // Registers were picked first and a question inside them second until
  // 2026-09-15, so a register holding one question was drawn as often as one
  // holding fifty: the seven autoethnographic registers were 7% of the Bank
  // and took 35% of its draws. The draw reads no register at all now.
  test('every question is equally likely, whatever its register', () => {
    const pool = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, register: 'big' })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, register: 'small' })),
    ];
    const random = mulberry32(7);
    const seen = new Map<string, number>();
    const n = 33000;
    for (let i = 0; i < n; i++) {
      const id = pickOne(pool, random)!.id;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    const counts = [...seen.values()];
    expect(seen.size).toBe(33);
    // every question near n/33 = 1000; no question starved or favoured
    expect(Math.min(...counts)).toBeGreaterThan(800);
    expect(Math.max(...counts)).toBeLessThan(1200);
  });

  test('every question is reachable', () => {
    const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const random = mulberry32(7);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(pickOne(pool, random)!.id);
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
  });

  test('empty pool draws nothing', () => {
    expect(pickOne([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The two jars.

const question = (id: string, register: string, due?: string): BankQuestion => {
  const q: BankQuestion = {
    kind: 'question',
    ref: { path: 'Bank/q', blockId: id },
    key: `Bank/q.md#^${id}`,
    text: `q ${id}?`,
    register,
    role: null,
    bankPath: 'Bank/q.md',
  };
  if (due) q.due = due;
  return q;
};

const file = { path: 'x.md', basename: 'x', extension: 'md' } as Paragraph['file'];
const paragraph = (key: string, wells: string[]): Paragraph => ({
  kind: 'paragraph',
  file,
  ref: { path: 'x', blockId: key },
  key,
  register: 'revisit',
  text: `paragraph ${key}`,
  origin: 'piece',
  wells,
  framing: 'in 2021',
  title: 'X',
  meta: [],
  line: 0,
});

const well = (kind: Well['kind'], name: string): Well => ({ kind, name, file: null });
const pool = (w: Well, n: number): WellPool => ({
  well: w,
  paragraphs: Array.from({ length: n }, (_, i) => paragraph(`${w.name}-${i}`, [w.name])),
});

describe('pickFromJars', () => {
  const jars: Jars = {
    bank: [question('b1', 'episode'), question('b2', 'value')],
    wells: [pool(well('me', 'me'), 3), pool(well('domain', 'Blender'), 3)],
  };

  test('the toss: under BANK_SHARE is the Bank jar, at or over it is the paragraph jar', () => {
    // toss, question | toss, well, paragraph. The Bank pick was two rolls
    // until 2026-09-17, when it picked a register first.
    const random = sequence([0.1, 0.0, 0.9, 0.99, 0.0]);
    const first = pickFromJars(jars, random);
    expect(first?.source.kind).toBe('question');
    expect(first?.source.key).toBe('Bank/q.md#^b1');
    expect(first?.well).toBeUndefined();
    const second = pickFromJars(jars, random);
    expect(second?.source.kind).toBe('paragraph');
    expect(second?.source.key).toBe('Blender-0');
    expect(second?.well?.name).toBe('Blender');
  });

  test('over many tosses the Bank takes BANK_SHARE of the draws', () => {
    const random = mulberry32(11);
    let questions = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (pickFromJars(jars, random)!.source.kind === 'question') questions++;
    expect(questions / n).toBeGreaterThan(BANK_SHARE - 0.03);
    expect(questions / n).toBeLessThan(BANK_SHARE + 0.03);
  });

  test('an empty jar hands the draw to the other, whatever the coin says', () => {
    const onlyBank: Jars = { bank: jars.bank, wells: [] };
    expect(pickFromJars(onlyBank, sequence([0.9, 0.0, 0.0]))?.source.kind).toBe('question');
    const onlyParagraphs: Jars = { bank: [], wells: jars.wells };
    expect(pickFromJars(onlyParagraphs, sequence([0.1, 0.0, 0.0]))?.source.kind).toBe('paragraph');
    expect(pickFromJars({ bank: [], wells: [] }, sequence([0.5]))).toBeNull();
  });

  test('a Domain with 100 paragraphs and a Learning note with 2 are picked equally often', () => {
    const skewed: Jars = { bank: [], wells: [pool(well('domain', 'Blender'), 100), pool(well('learning', 'Dutch'), 2)] };
    const random = mulberry32(5);
    let dutch = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (pickFromJars(skewed, random)!.well?.name === 'Dutch') dutch++;
    expect(dutch / n).toBeGreaterThan(0.47);
    expect(dutch / n).toBeLessThan(0.53);
  });

  test('a bank question with a relative due gets an absolute date from today', () => {
    const due: Jars = { bank: [question('b1', 'episode', '+7d')], wells: [] };
    expect(pickFromJars(due, sequence([0.0]), new Date(2026, 8, 13))?.due).toBe('2026-09-20');
  });
});

describe('jarCounts', () => {
  test('counts questions, distinct paragraphs, and wells with something left', () => {
    const shared = paragraph('Pieces/x.md#^p-001', ['Blender', 'Cities']);
    const jars: Jars = {
      bank: [question('b1', 'episode')],
      wells: [
        { well: well('domain', 'Blender'), paragraphs: [shared, paragraph('Pieces/y.md#^p-001', ['Blender'])] },
        { well: well('domain', 'Cities'), paragraphs: [shared] },
      ],
    };
    expect(jarCounts(jars)).toEqual({ questions: 1, paragraphs: 2, wells: 2 });
  });
});
