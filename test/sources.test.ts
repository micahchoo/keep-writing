import { describe, expect, test } from 'bun:test';
import { AnsweredIndex, fillJars, jarCounts } from '../src/bank';
import type { DrawContext } from '../src/bank';
import { allWells, readTarget } from '../src/target';
import { fakeVault } from './fake-vault';

// The two jars over one small vault: a plain bank, a Domain gathering a
// finished Piece, a Learning note, a Sitting, an open Piece, and Sittings
// that set `about`.

const vault = fakeVault({
  'Bank/q.md': '---\nkind: bank\n---\n- what are you saving up for? #register/intention ^b1\n- what album? #register/belief ^b2\n',
  'Bank/closing.md': '---\nkind: bank\n---\n- what did we not touch today? #register/state #role/door ^x-001\n- where should we pick up? #register/intention #role/bookmark ^x-005\n',
  'Bank/notes.md': '- not a bank note, no kind ^n1\n',
  'Domains/Cities.md': '---\nkind: domain\ngathers:\n- cities\n---\n\nI walk to think, and the city gives back a different thought each morning.\n',
  'Learning/Dutch.md': '---\nkind: learning\n---\n\nI want to read Reve in Dutch, without a dictionary open beside the book.\n',
  'Pieces/2021-koramangala.md':
    '---\nkind: piece\nstatus: published\ndate: 2021-03-04\ntitle: Koramangala\ntags: [cities]\n---\n\nThe buffaloes did not look up when the whole procession went past the auto stand. ^p-001\n\nI wrote that down in a notebook and never used it in anything I published. ^p-002\n',
  'Pieces/rivers.md': '---\nkind: piece\n---\n\nA draft paragraph of the Piece I am writing now, still open and still moving. ^p-001\n',
  'Sittings/2026-09-12.md': '## Asked\n\nAn old answer about the river, written before I knew what I was looking for. ^ans1\n',
  'Sittings/2026-09-14.md': '---\nabout: "[[Pieces/2021-koramangala]]"\n---\n\n## Asked\n',
  'Sittings/2026-09-15.md': '---\nabout: "[[Cities]]"\nanswers:\n  - "[[Pieces/2021-koramangala#^p-001]]"\n---\n\n## Asked\n\nAnswered it at length, and the answer turned into something I did not expect. ^ans2\n',
  'Sittings/2026-09-16.md': '---\nabout: "[[Pieces/rivers]]"\n---\n\n## Asked\n',
});
const { app, file } = vault;

const ctx = (skipped: string[] = []): DrawContext => ({
  app,
  bankFolder: 'Bank',
  sittingsFolder: 'Sittings',
  index: new AnsweredIndex(app),
  skipped: new Set(skipped),
});

describe('Wells', () => {
  test('the self, each Domain, each Learning note; a Piece, open or finished, is not one', () => {
    expect(allWells(app).map((w) => `${w.kind}:${w.name}`)).toEqual(['me:me', 'domain:Cities', 'learning:Dutch']);
  });
  test('about names a Well or a finished Piece', () => {
    expect(readTarget(app, file('Sittings/2026-09-14.md'))).toMatchObject({ kind: 'piece', name: '2021-koramangala' });
    expect(readTarget(app, file('Sittings/2026-09-15.md'))).toMatchObject({ kind: 'domain', name: 'Cities' });
    expect(readTarget(app, file('Sittings/2026-09-12.md'))).toBeNull();
  });
});

describe('fillJars, roaming', () => {
  test('the Bank jar is every role-less entry of every kind: bank note; the paragraph jar is filed under Wells', async () => {
    const jars = await fillJars(ctx(), null);
    expect(jars.bank.map((q) => q.key).sort()).toEqual(['Bank/q.md#^b1', 'Bank/q.md#^b2']);
    const pools = Object.fromEntries(jars.wells.map((p) => [p.well.name, p.paragraphs.map((x) => x.key).sort()]));
    expect(pools).toEqual({
      me: ['Sittings/2026-09-12.md#^ans1', 'Sittings/2026-09-15.md#^ans2'],
      Cities: ['Domains/Cities.md#L6', 'Pieces/2021-koramangala.md#^p-002'],
      Dutch: ['Learning/Dutch.md#L4'],
    });
    expect(jarCounts(jars)).toEqual({ questions: 2, paragraphs: 5, wells: 3 });
  });

  test('a paragraph is answered when any block carries an answers link to it', async () => {
    const jars = await fillJars(ctx(), null);
    const keys = jars.wells.flatMap((p) => p.paragraphs.map((x) => x.key));
    expect(keys).not.toContain('Pieces/2021-koramangala.md#^p-001');
  });

  test('skipped sources are out; a Well with nothing left is not a pool', async () => {
    const jars = await fillJars(ctx(['Learning/Dutch.md#L4', 'Bank/q.md#^b1']), null);
    expect(jars.bank.map((q) => q.key)).toEqual(['Bank/q.md#^b2']);
    expect(jars.wells.map((p) => p.well.name)).toEqual(['me', 'Cities']);
  });
});

describe('fillJars with a Target', () => {
  test('a Domain: no Bank; that Well only', async () => {
    const jars = await fillJars(ctx(), readTarget(app, file('Sittings/2026-09-15.md')));
    expect(jars.bank).toEqual([]);
    expect(jars.wells.map((p) => p.well.name)).toEqual(['Cities']);
    expect(jars.wells[0]?.paragraphs.map((x) => x.key).sort()).toEqual(['Domains/Cities.md#L6', 'Pieces/2021-koramangala.md#^p-002']);
  });

  test('a finished Piece: its own paragraphs, still filed under the Well that gathers it', async () => {
    const jars = await fillJars(ctx(), readTarget(app, file('Sittings/2026-09-14.md')));
    expect(jars.bank).toEqual([]);
    expect(jars.wells.map((p) => p.well.name)).toEqual(['Cities']);
    expect(jars.wells[0]?.paragraphs.map((x) => x.key)).toEqual(['Pieces/2021-koramangala.md#^p-002']);
  });

  test('an open Piece: nothing to draw', async () => {
    const jars = await fillJars(ctx(), readTarget(app, file('Sittings/2026-09-16.md')));
    expect(jars.bank).toEqual([]);
    expect(jars.wells).toEqual([]);
  });
});

// A role is read off the entry, not off the filename. `Templates/Sitting.md`
// carries the closing moves into every Sitting under their own heading, so
// nothing draws one and the jar must never offer one either: it would place
// the same Ask twice.
describe('roles', () => {
  test('a role-tagged entry stays out of the Bank jar, whatever the role', async () => {
    const read = await fillJars(ctx(), null);
    const keys = read.bank.map((q) => q.key);
    expect(keys).not.toContain('Bank/closing.md#^x-001');
    expect(keys).not.toContain('Bank/closing.md#^x-005');
  });

  test('a Target empties the Bank jar', async () => {
    const read = await fillJars(ctx(), readTarget(app, file('Sittings/2026-09-15.md')));
    expect(read.bank).toEqual([]);
  });
});
