// The Furniture tests: what carries a block id but nobody wrote. Each rule
// catches a species the others miss, and the three paths take them
// differently — see CONTEXT.md, "Furniture".

import { describe, expect, test } from 'bun:test';
import { headingAbove, isFurniture, proseOf, readsAsParagraph } from '../src/furniture';
import { fakeVault } from './fake-vault';

describe('proseOf', () => {
  test('markup out, words kept', () => {
    expect(proseOf('{{< figure src="a.jpeg" alt="Stylized basemap in Mapbox" >}}')).toBe('');
    expect(proseOf('{:toc}')).toBe('');
    expect(proseOf('{{< /card >}}')).toBe('');
    expect(proseOf('https://escholarship.org/uc/item/6xj932f8?s=09')).toBe('');
    expect(proseOf('<div style="padding: 20px;">')).toBe('');
    expect(proseOf('![a map](map.png)')).toBe('');
  });
  test('a link keeps its words and loses its URL', () => {
    expect(proseOf('the map in [this Compost.mag piece]({{< ref "technofutures" >}}) felt like magic')).toBe(
      'the map in this Compost.mag piece felt like magic',
    );
  });
  test('prose with no markup is returned whole', () => {
    const p = 'I started reading up about it and coming back to it every two months.';
    expect(proseOf(p)).toBe(p);
  });
});

describe('readsAsParagraph', () => {
  test('nothing but markup is furniture', () => {
    expect(readsAsParagraph('{{< figure src="a.jpeg" alt="Stylized basemap in Mapbox" >}}')).toBe(false);
    expect(readsAsParagraph('[Website in Excel form](https://docs.google.com/spreadsheets/d/1i3)')).toBe(false);
  });
  test('a caption or a project-sheet field is furniture, however long', () => {
    expect(readsAsParagraph('Fig 13: I helped the Sukhibhava team make this poster which was then translated')).toBe(false);
    expect(readsAsParagraph('**My Role:** User Research, Prototyping, Play system, Nomenclature and Typology')).toBe(false);
    expect(readsAsParagraph('> Duration: 1 month')).toBe(false);
  });
  test('a bibliography entry is furniture because of the heading it sits under', () => {
    const cite = 'Suchman, Lucy, and NCSAatIllinois. 2018. Relocating Innovation: Places And Practices Of Future.';
    expect(readsAsParagraph(cite, 'bibliography')).toBe(false);
    expect(readsAsParagraph(cite, 'other references')).toBe(false);
    // The same words under an ordinary heading are only measured on length.
    expect(readsAsParagraph(cite, 'fragility')).toBe(true);
  });
  test('under the floor is furniture, and that costs some real short lines', () => {
    expect(readsAsParagraph('Here are some key points:')).toBe(false);
    // Known cost of the floor, accepted 2026-09-15: the draw loses these,
    // the owner can still reach them by hand (selection.ts).
    expect(readsAsParagraph('Who gets to hold memory, and on whose terms?')).toBe(false);
  });
  test("the owner's prose passes, markup in it or not", () => {
    expect(
      readsAsParagraph('I started reading up about it and coming back to it every two months. It was dense.'),
    ).toBe(true);
    expect(
      readsAsParagraph('At that time, I was using OpenSeadragon as a way to create the map in [this piece](x).'),
    ).toBe(true);
  });
});

describe('isFurniture vs readsAsParagraph', () => {
  const own = 'Who gets to hold memory, and on whose terms?';
  test('the floor separates them: the draw refuses this line, everything else keeps it', () => {
    expect(isFurniture(own)).toBe(false);
    expect(readsAsParagraph(own)).toBe(false);
  });
  test('furniture fails both, whatever its length', () => {
    expect(isFurniture('{{< /card >}}')).toBe(true);
    expect(isFurniture('Fig 13: I helped the Sukhibhava team make this poster which was then translated')).toBe(true);
    expect(isFurniture('Ahmed, Sara. Fragile Connections. Durham: Duke University Press.', 'bibliography')).toBe(true);
  });
});

describe('headingAbove', () => {
  const { app, file } = fakeVault({
    'Pieces/p.md':
      ['---', 'kind: piece', 'status: published', '---', '', '## Fragility', '', 'A paragraph.', '', '## Bibliography', '', 'A citation.'].join('\n'),
  });
  const cache = app.metadataCache.getFileCache(file('Pieces/p.md'));
  test('the nearest heading at or above the line, lower-cased', () => {
    expect(headingAbove(cache, 7)).toBe('fragility');
    expect(headingAbove(cache, 11)).toBe('bibliography');
  });
  test('empty above the first heading, and with no cache', () => {
    expect(headingAbove(cache, 4)).toBe('');
    expect(headingAbove(null, 9)).toBe('');
  });
});
