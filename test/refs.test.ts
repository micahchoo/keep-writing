import { describe, expect, test } from 'bun:test';
import { formatRef, newBlockId, parseRef, stripBlockDecoration, wikilink } from '../src/refs';

describe('refs', () => {
  test('parse/format round trip for a block ref', () => {
    const text = 'Bank/questions for meaningful introductions#^b17850831';
    const ref = parseRef(text);
    expect(ref).toEqual({ path: 'Bank/questions for meaningful introductions', blockId: 'b17850831' });
    expect(formatRef(ref!)).toBe(text);
  });

  test('parse/format round trip for a note ref', () => {
    const ref = parseRef('Domains/Blender');
    expect(ref).toEqual({ path: 'Domains/Blender' });
    expect(formatRef(ref!)).toBe('Domains/Blender');
    expect(wikilink(ref!)).toBe('[[Domains/Blender]]');
  });

  test('accepts wikilink wrapping and aliases', () => {
    expect(parseRef('[[Sittings/2026-09-13#^ab12cd|the answer]]')).toEqual({
      path: 'Sittings/2026-09-13',
      blockId: 'ab12cd',
    });
  });

  test('heading subpaths fall back to the note', () => {
    expect(parseRef('Note#Heading')).toEqual({ path: 'Note' });
    expect(parseRef('')).toBeNull();
    expect(parseRef('#^abc')).toBeNull();
  });

  test('block ids are six lowercase alphanumerics and avoid taken ids', () => {
    const seq = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const random = () => seq[i++ % seq.length]!;
    const taken = { blocks: { aaaaaa: { id: 'aaaaaa', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } } } };
    const id = newBlockId(taken as never, random);
    expect(id).toMatch(/^[a-z0-9]{6}$/);
    expect(id).not.toBe('aaaaaa');
  });

  test('strips list marker and block id from block text', () => {
    expect(stripBlockDecoration('- what album are you resonating with? #register/belief ^b17850727')).toBe(
      'what album are you resonating with? #register/belief',
    );
  });
});
