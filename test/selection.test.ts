import { describe, expect, test } from 'bun:test';
import { MAX_SELECTION, NotSelectable, selectionParagraph } from '../src/selection';
import { fakeVault } from './fake-vault';

const SITTING = [
  '---',
  'about: "[[Blender]]"',
  '---',
  '',
  '## Asked',
  '',
  '> [!ask] what did you make?',
  '> from [[Bank/craft#^b1]]',
  '',
  'The first paragraph of the answer. ^a1',
  '',
  'The second paragraph, which no block id reaches.',
  'It runs to a second line.',
  '',
].join('\n');

const PIECE = [
  '---',
  'title: Feeling Through the Cities',
  'date: 2021-03-04',
  'status: published',
  'external_publisher: Branch Magazine',
  'tags: [blender]',
  '---',
  '',
  'The buffaloes went past the auto stand. ^p-004',
  '',
].join('\n');

const OPEN_PIECE = ['---', 'title: The one I am writing', '---', '', 'A paragraph with no id yet.', ''].join('\n');

const DOMAIN = ['---', 'gathers: [blender]', '---', '', 'I rig characters badly. ^r1', ''].join('\n');

const { app, file } = fakeVault({
  'Sittings/2026-09-13.md': SITTING,
  'Pieces/2021-cities.md': PIECE,
  'Pieces/open.md': OPEN_PIECE,
  'Domains/Blender.md': DOMAIN,
  'Bank/craft.md': '- what did you make? ^b1\n',
});
const pick = (path: string, selected: string, line: number) =>
  selectionParagraph(app, file(path), selected, line, 'Sittings');

describe('a selection in a Sitting', () => {
  test('a paragraph with no id is a source anyway: the key and the line carry it until the Ask is accepted', () => {
    const p = pick('Sittings/2026-09-13.md', 'The second paragraph, which no block id reaches.', 11);
    expect(p.key).toBe('Sittings/2026-09-13.md#L11');
    expect(p.ref.blockId).toBeUndefined();
    expect(p.line).toBe(11);
    expect(p.origin).toBe('sitting');
    expect(p.wells).toEqual(['me']);
    expect(p.framing).toBe('in a Sitting on 2026-09-13');
    expect(p.title).toBe('Sitting 2026-09-13');
  });

  test('the text is what was selected, not the whole block', () => {
    expect(pick('Sittings/2026-09-13.md', 'no block id reaches', 11).text).toBe('no block id reaches');
  });

  test('a block that already has an id keeps it, and the id is stripped from the text', () => {
    const p = pick('Sittings/2026-09-13.md', 'The first paragraph of the answer. ^a1', 9);
    expect(p.ref.blockId).toBe('a1');
    expect(p.key).toBe('Sittings/2026-09-13.md#^a1');
    expect(p.text).toBe('The first paragraph of the answer.');
  });
});

describe('what a selection refuses', () => {
  const refuse = (selected: string) => () => pick('Pieces/2021-cities.md', selected, 8);

  test('a selection with no prose in it: the model would have nothing to ask about', () => {
    expect(refuse('{{< figure src="buffalo.jpeg" alt="The procession" >}}')).toThrow(NotSelectable);
    expect(refuse('![a map](map.png)')).toThrow(NotSelectable);
    expect(refuse('https://escholarship.org/uc/item/6xj932f8')).toThrow(/link, an image or markup/);
  });

  test("the jar's word floor does not apply: what the owner points at, they meant", () => {
    // Furniture to the draw (under MIN_PROSE_WORDS), a good source by hand.
    expect(refuse('Who gets to hold memory?')).not.toThrow();
    expect(pick('Pieces/2021-cities.md', 'Who gets to hold memory?', 8).text).toBe('Who gets to hold memory?');
  });

  test('a link keeps its words, so prose around a link is still selectable', () => {
    expect(refuse('the map in [this Compost.mag piece](https://compost.mag/x)')).not.toThrow();
  });
});

describe('a selection elsewhere', () => {
  test('a published Piece brings its framing, its title and the Domain that gathers it', () => {
    const p = pick('Pieces/2021-cities.md', 'The buffaloes went past the auto stand.', 8);
    expect(p.origin).toBe('piece');
    expect(p.wells).toEqual(['Blender']);
    expect(p.framing).toBe('in 2021, in "Feeling Through the Cities", for Branch Magazine');
    expect(p.title).toBe('Feeling Through the Cities');
    expect(p.ref.blockId).toBe('p-004');
  });

  test('an open Piece was not written some time ago: it is the one being written', () => {
    expect(pick('Pieces/open.md', 'A paragraph with no id yet.', 4).framing).toBe('in "The one I am writing", the Piece they are writing');
  });

  test('a Domain body is filed under that Domain, so the craft Lens frames the question', () => {
    const p = pick('Domains/Blender.md', 'I rig characters badly.', 4);
    expect(p.origin).toBe('domain');
    expect(p.wells).toEqual(['Blender']);
    expect(p.framing).toBe('in their note on Blender');
  });
});

describe('what is not a selection to ask about', () => {
  test('nothing selected', () => {
    expect(() => pick('Sittings/2026-09-13.md', '   \n  ', 11)).toThrow(NotSelectable);
  });

  test('more than the model can hold one question about', () => {
    expect(() => pick('Sittings/2026-09-13.md', 'x'.repeat(MAX_SELECTION + 1), 11)).toThrow(NotSelectable);
  });

  test('a note the owner does not write paragraphs in', () => {
    expect(() => pick('Bank/craft.md', 'what did you make?', 0)).toThrow(NotSelectable);
  });

  test('a line that is not inside a paragraph', () => {
    expect(() => pick('Sittings/2026-09-13.md', 'nothing here', 3)).toThrow(NotSelectable);
  });
});
