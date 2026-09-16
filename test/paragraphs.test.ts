import { describe, expect, test } from 'bun:test';
import { bodyUnits, framingOf, noteFraming, paragraphJar, sittingFraming } from '../src/paragraphs';
import { fakeVault } from './fake-vault';

describe('framing', () => {
  test('a published piece names the year and the publisher', () => {
    expect(framingOf({ pieceDate: '2021-03-04', status: 'published', publisher: 'Branch Magazine' })).toBe(
      'in 2021, for Branch Magazine',
    );
  });
  test('a set-down piece says so', () => {
    expect(framingOf({ pieceDate: '2020-11-30', status: 'set-down' })).toBe('in 2020, in a draft they set down');
  });
  test('self-published: the year alone; no date: some time ago', () => {
    expect(framingOf({ pieceDate: '2019-01-01', status: 'published' })).toBe('in 2019');
    expect(framingOf({ pieceDate: '', status: 'published' })).toBe('some time ago');
  });
  test('a Domain or Learning body, and a Sitting', () => {
    expect(noteFraming('domain', 'Blender')).toBe('in their note on Blender');
    expect(noteFraming('learning', 'Dutch')).toBe('in what they wrote about wanting to learn Dutch');
    expect(sittingFraming('2026-09-12')).toBe('in a Sitting on 2026-09-12');
  });
});

describe('bodyUnits', () => {
  const { app, file } = fakeVault({
    'Domains/Blender.md': [
      '---',
      'kind: domain',
      '---',
      '',
      '## Notes',
      '',
      'I rig characters badly.',
      'Every shoulder folds like paper.',
      '',
      '- the first rig ^r1',
      '- the second rig',
      '',
      '> a quote with no id',
      '',
      '> a quote with an id',
      '^q1',
      '',
      '```',
      'code',
      '```',
      '',
      'One more paragraph. ^p9',
    ].join('\n'),
  });

  test('paragraphs and list items, id or not; a blockquote only with an id; no heading, code or frontmatter', () => {
    expect(bodyUnits(app.metadataCache.getFileCache(file('Domains/Blender.md')))).toEqual([
      { start: 6, end: 7 },
      { start: 9, end: 9, id: 'r1' },
      { start: 10, end: 10 },
      { start: 14, end: 15, id: 'q1' },
      { start: 21, end: 21, id: 'p9' },
    ]);
  });
});

describe('paragraphJar', () => {
  const vault = fakeVault({
    'Domains/Cities.md': '---\nkind: domain\ngathers:\n- cities\n---\n\nI walk to think. ^w1\n\nEvery city I lived in for a week has a poem.\n',
    'Learning/Dutch.md': '---\nkind: learning\n---\n\nI want to read Reve in Dutch.\n',
    'Pieces/2021-koramangala.md':
      '---\nkind: piece\nstatus: published\ndate: 2021-03-04\ntitle: Koramangala\nexternal_publisher: Branch Magazine\ntags: [cities]\n---\n\nThe buffaloes did not look up. ^p-001\n\nI wrote that down and never used it. ^p-002\n',
    'Pieces/2019-loose.md': '---\nkind: piece\nstatus: set-down\ndate: 2019-05-05\n---\n\nA draft nobody gathers. ^p-001\n',
    'Pieces/index.md': '---\nkind: piece\nstatus: page\n---\n\nSite furniture. ^p-001\n',
    'Pieces/rivers.md': '---\nkind: piece\n---\n\nAn open draft with an id. ^p-001\n',
    'Sittings/2026-09-12.md': '## Asked\n\n> [!ask] what did we not touch?\n> from [[Bank/closing#^x-001]]\n\nThe river, again. ^ans1\n',
    'me.md': 'The self.\n',
    'Bank/q.md': '---\nkind: bank\n---\n- a question? #register/value ^b1\n',
  });

  test('files every shelf under its Well; open Pieces, pages and me.md stay out', async () => {
    const jar = await paragraphJar(vault.app, 'Sittings');
    const byKey = Object.fromEntries(jar.map((p) => [p.key, p]));
    expect(Object.keys(byKey).sort()).toEqual([
      'Domains/Cities.md#L8',
      'Domains/Cities.md#^w1',
      'Learning/Dutch.md#L4',
      'Pieces/2019-loose.md#^p-001',
      'Pieces/2021-koramangala.md#^p-001',
      'Pieces/2021-koramangala.md#^p-002',
      'Sittings/2026-09-12.md#^ans1',
    ]);
    expect(byKey['Pieces/2021-koramangala.md#^p-001']?.wells).toEqual(['Cities']);
    expect(byKey['Pieces/2019-loose.md#^p-001']?.wells).toEqual(['me']);
    expect(byKey['Sittings/2026-09-12.md#^ans1']?.wells).toEqual(['me']);
    expect(byKey['Domains/Cities.md#^w1']?.wells).toEqual(['Cities']);
    expect(byKey['Learning/Dutch.md#L4']?.wells).toEqual(['Dutch']);
  });

  test('a Piece paragraph carries its framing and pane facts', async () => {
    const jar = await paragraphJar(vault.app, 'Sittings');
    const p = jar.find((x) => x.key === 'Pieces/2021-koramangala.md#^p-001')!;
    expect(p.text).toBe('The buffaloes did not look up.');
    expect(p.framing).toBe('in 2021, for Branch Magazine');
    expect(p.title).toBe('Koramangala');
    expect(p.meta).toEqual(['2021-03-04', 'Branch Magazine']);
    expect(p.ref).toEqual({ path: 'Pieces/2021-koramangala', blockId: 'p-001' });
    const d = jar.find((x) => x.key === 'Pieces/2019-loose.md#^p-001')!;
    expect(d.framing).toBe('in 2019, in a draft they set down');
    expect(d.meta).toEqual(['2019-05-05', 'set down']);
  });

  test('a Sitting answer is a paragraph of the self, framed by its day', async () => {
    const jar = await paragraphJar(vault.app, 'Sittings');
    const p = jar.find((x) => x.origin === 'sitting')!;
    expect(p.text).toBe('The river, again.');
    expect(p.framing).toBe('in a Sitting on 2026-09-12');
    expect(p.title).toBe('Sitting 2026-09-12');
  });

  test('a Domain body paragraph without an id is drawable: note-level ref, line kept for the id it gets on accept', async () => {
    const jar = await paragraphJar(vault.app, 'Sittings');
    const p = jar.find((x) => x.key === 'Domains/Cities.md#L8')!;
    expect(p.text).toBe('Every city I lived in for a week has a poem.');
    expect(p.ref).toEqual({ path: 'Domains/Cities' });
    expect(p.line).toBe(8);
    expect(p.framing).toBe('in their note on Cities');
    const withId = jar.find((x) => x.key === 'Domains/Cities.md#^w1')!;
    expect(withId.ref).toEqual({ path: 'Domains/Cities', blockId: 'w1' });
    expect(withId.text).toBe('I walk to think.');
  });
});
