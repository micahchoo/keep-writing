import { describe, expect, test } from 'bun:test';
import {
  framingOf,
  noteFraming,
  oneTellingEachAsync,
  paragraphJar,
  sittingFraming,
  sittingName,
} from '../src/paragraphs';
import type { Paragraph } from '../src/paragraphs';
import { blockTexts } from '../src/refs';
import { fakeVault } from './fake-vault';

describe('framing', () => {
  test('a published piece names the year, the Piece and the publisher', () => {
    expect(
      framingOf({ pieceDate: '2021-03-04', status: 'published', title: 'Koramangala', publisher: 'Branch Magazine' }),
    ).toBe('in 2021, in "Koramangala", for Branch Magazine');
  });
  test('a set-down piece says so', () => {
    expect(framingOf({ pieceDate: '2020-11-30', status: 'set-down', title: 'Rivers' })).toBe(
      'in 2020, in "Rivers", a draft they set down',
    );
  });
  test('self-published: the year and the Piece; no date: some time ago', () => {
    expect(framingOf({ pieceDate: '2019-01-01', status: 'published', title: 'Habba' })).toBe('in 2019, in "Habba"');
    expect(framingOf({ pieceDate: '', status: 'published', title: 'Habba' })).toBe('some time ago, in "Habba"');
  });
  test('a Piece with no title at all falls back to when alone', () => {
    expect(framingOf({ pieceDate: '2019-01-01', status: 'published', title: '' })).toBe('in 2019');
  });
  test('any other note, and a Sitting', () => {
    expect(noteFraming('Blender')).toBe('in their note on Blender');
    expect(sittingFraming('2026-09-12')).toBe('in a Sitting on 2026-09-12');
  });

  // Four of the seven real Sittings on 2026-09-16 had been renamed off the
  // template's date. Each framed as "in a Sitting on <title>" before this.
  test('a Sitting the owner renamed is framed by its name, not as a date', () => {
    expect(sittingFraming('Suffering a Repitition')).toBe('in a Sitting they called "Suffering a Repitition"');
    expect(sittingFraming('Not ready for?')).toBe('in a Sitting they called "Not ready for?"');
  });

  test('a Sitting that kept its date and took a name carries both', () => {
    expect(sittingFraming('2026-09-12-prattler')).toBe('in a Sitting on 2026-09-12 they called "prattler"');
  });

  test('sittingName splits the date from the owner\'s own name', () => {
    expect(sittingName('2026-09-15')).toEqual({ date: '2026-09-15', called: '' });
    expect(sittingName('2026-09-12-prattler')).toEqual({ date: '2026-09-12', called: 'prattler' });
    expect(sittingName('Back to College?')).toEqual({ date: '', called: 'Back to College?' });
  });
});

describe('oneTellingEach', () => {
  const para = (path: string, text: string, status: string, wells: string[]) =>
    ({
      kind: 'paragraph', file: { path } as never, ref: { path }, key: `${path}#^x`,
      register: 'revisit', text, origin: 'piece', wells, framing: '', title: path, meta: [],
      line: 0, status,
    }) as never as Paragraph;

  // The real pair, 86 blocks deep, measured 2026-09-16.
  const PUB = 'Pieces/2020-03-01-carefull-collectives.md';
  const MIRROR = 'Pieces/0000-00-00-careful-collectives-micah-alex.md';
  const TEXT = 'In Bidar, there is a community called the Valmiki Samaj who had been doing this for years.';

  test('two tellings of one paragraph become one, and the finished telling is kept', async () => {
    const out = await oneTellingEachAsync([para(MIRROR, TEXT, 'set-down', ['me']), para(PUB, TEXT, 'published', ['Cities'])]);
    expect(out.length).toBe(1);
    expect(out[0]!.file.path).toBe(PUB);
  });

  test('order does not decide the winner, so the draw cannot shift between runs', async () => {
    const a = await oneTellingEachAsync([para(MIRROR, TEXT, 'set-down', []), para(PUB, TEXT, 'published', [])]);
    const b = await oneTellingEachAsync([para(PUB, TEXT, 'published', []), para(MIRROR, TEXT, 'set-down', [])]);
    expect(a[0]!.file.path).toBe(b[0]!.file.path);
  });

  test('two set-down tellings tie-break on path, never at random', async () => {
    const out = await oneTellingEachAsync([para('Pieces/z.md', TEXT, 'set-down', []), para('Pieces/a.md', TEXT, 'set-down', [])]);
    expect(out[0]!.file.path).toBe('Pieces/a.md');
  });

  test('different paragraphs are all kept, in the order they came', async () => {
    const out = await oneTellingEachAsync([para(PUB, 'one paragraph', 'published', []), para(PUB, 'another paragraph', 'published', [])]);
    expect(out.map((p) => p.text)).toEqual(['one paragraph', 'another paragraph']);
  });
});

describe('paragraphJar', () => {
  const vault = fakeVault({
    'Domains/Cities.md': '---\nkind: domain\ngathers:\n- cities\n---\n\nI walk to think, and the city gives back a different thought each morning. ^w1\n\nEvery city I lived in for a week has a poem I never finished writing down.\n',
    'Learning/Dutch.md': '---\nkind: learning\n---\n\nI want to read Reve in Dutch, without a dictionary open beside the book.\n',
    // Furniture the corpus import gave ids to, beside the owner's paragraphs:
    // a figure shortcode, a caption, a citation under a Bibliography heading.
    'Pieces/2021-koramangala.md': [
      '---',
      'kind: piece',
      'status: published',
      'date: 2021-03-04',
      'title: Koramangala',
      'external_publisher: Branch Magazine',
      'tags: [cities]',
      '---',
      '',
      'The buffaloes did not look up when the whole procession went past the auto stand. ^p-001',
      '',
      '{{< figure src="buffalo.jpeg" alt="The procession" caption="The procession" >}} ^p-003',
      '',
      'Fig 4: The auto stand at Koramangala, photographed the following morning ^p-004',
      '',
      'I wrote that down in a notebook and never used it in anything I published. ^p-002',
      '',
      '## Bibliography',
      '',
      'Suchman, Lucy, and NCSAatIllinois. 2018. Relocating Innovation: Places And Practices. ^p-005',
    ].join('\n'),
    'Pieces/2019-loose.md': '---\nkind: piece\nstatus: set-down\ndate: 2019-05-05\n---\n\nA draft nobody gathers, set down in the year I stopped writing for other people. ^p-001\n',
    'Pieces/index.md': '---\nkind: piece\nstatus: page\n---\n\nSite furniture that lists the sections of the website and links each one of them. ^p-001\n',
    'Pieces/rivers.md': '---\nkind: piece\n---\n\nAn open draft with an id, sitting in a Piece that has no status yet. ^p-001\n',
    'Sittings/2026-09-12.md': '## Asked\n\n> [!ask] what did we not touch?\n> from [[Bank/closing#^x-001]]\n\nThe river, again, and the way it goes quiet under the bridge near the market. ^ans1\n',
    'Sittings/Suffering a Repitition.md':
      '## Asked\n\n> [!ask] what makes repetition hopeless or energizing?\n> from [[Bank/q#^b1]]\n\nWhen things occur over and over we cannot stop the train, and the stakes are the whole of it. ^ans9\n',
    'me.md': 'The self, which gathers every paragraph that no Domain in the vault has claimed.\n',
    'Bank/q.md': '---\nkind: bank\n---\n- a question? #register/value ^b1\n',
  });

  /** What the owner named in settings. `Domains/` and `me.md` are in neither. */
  const FOLDERS = ['Sittings', 'Pieces'];
  const jarOf = (folders = FOLDERS) => paragraphJar(vault.app, 'Sittings', folders);

  // The jar was `Pieces/` and `Sittings/` by path, and a Piece also needed a
  // `status`, until 2026-09-17. One rule now: an id'd block in a folder the
  // owner named. An open Piece is IN — it has no status to be finished by, and
  // a rule that needs one is a rule nobody else's vault can satisfy.
  test('every id`d block of every named folder; furniture never enters', async () => {
    expect((await jarOf()).map((p) => p.key).sort()).toEqual([
      'Pieces/2019-loose.md#^p-001',
      'Pieces/2021-koramangala.md#^p-001',
      'Pieces/2021-koramangala.md#^p-002',
      'Pieces/rivers.md#^p-001',
      'Sittings/2026-09-12.md#^ans1',
      'Sittings/Suffering a Repitition.md#^ans9',
    ]);
  });

  // The fence that mattered was never the folder name; it is what reads as a
  // paragraph the owner wrote.
  test('the three species of furniture are strained out, each by its own rule', async () => {
    // The file carries five blocks with ids...
    const ids = (await blockTexts(vault.app, vault.file('Pieces/2021-koramangala.md'))).map((b) => b.id);
    expect(ids.sort()).toEqual(['p-001', 'p-002', 'p-003', 'p-004', 'p-005']);
    // ...the jar keeps the two that are paragraphs, not a figure, a caption or
    // a citation.
    const keys = (await jarOf()).map((p) => p.key);
    expect(keys.filter((k) => k.startsWith('Pieces/2021-koramangala')).sort()).toEqual([
      'Pieces/2021-koramangala.md#^p-001',
      'Pieces/2021-koramangala.md#^p-002',
    ]);
  });

  test('a folder the owner did not name is never read', async () => {
    const keys = (await jarOf(['Sittings'])).map((p) => p.key);
    expect(keys.every((k) => k.startsWith('Sittings/'))).toBe(true);
    // And naming it brings it in: `Domains/Cities.md` has one id`d paragraph.
    expect((await jarOf(['Domains'])).map((p) => p.key)).toEqual(['Domains/Cities.md#^w1']);
  });

  // The one opt-out a note inside a named folder has. `Pieces/index.md` is a
  // section index: finished and linkable, never put in front of the owner.
  test('`status: page` keeps a note out of the jar', async () => {
    expect((await jarOf()).some((p) => p.file.path === 'Pieces/index.md')).toBe(false);
  });

  test('a Piece paragraph carries its framing and pane facts', async () => {
    const jar = await jarOf();
    const p = jar.find((x) => x.key === 'Pieces/2021-koramangala.md#^p-001')!;
    expect(p.text).toBe('The buffaloes did not look up when the whole procession went past the auto stand.');
    expect(p.framing).toBe('in 2021, in "Koramangala", for Branch Magazine');
    expect(p.title).toBe('Koramangala');
    expect(p.meta).toEqual(['2021-03-04', 'Branch Magazine']);
    expect(p.ref).toEqual({ path: 'Pieces/2021-koramangala', blockId: 'p-001' });
    const d = jar.find((x) => x.key === 'Pieces/2019-loose.md#^p-001')!;
    expect(d.framing).toBe('in 2019, in "2019-loose", a draft they set down');
    expect(d.meta).toEqual(['2019-05-05', 'set down']);
  });

  test('a Sitting answer is a paragraph of the self, framed by its day', async () => {
    const jar = await jarOf();
    const p = jar.find((x) => x.key === 'Sittings/2026-09-12.md#^ans1')!;
    expect(p.text).toBe('The river, again, and the way it goes quiet under the bridge near the market.');
    expect(p.framing).toBe('in a Sitting on 2026-09-12');
    expect(p.title).toBe('Sitting 2026-09-12');
  });

  test('a renamed Sitting is framed and shown by the name the owner gave it', async () => {
    const jar = await jarOf();
    const p = jar.find((x) => x.key === 'Sittings/Suffering a Repitition.md#^ans9')!;
    expect(p.framing).toBe('in a Sitting they called "Suffering a Repitition"');
    expect(p.title).toBe('Suffering a Repitition');
  });

});
