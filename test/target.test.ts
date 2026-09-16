import { describe, expect, test } from 'bun:test';
import { gatherers, normalizeTag } from '../src/target';

// Gathering: how a Domain claims the Pieces about it. Pure; no vault needed.
describe('gatherers', () => {
  const domains = [
    { name: 'Cities', gathers: ['cities', 'walking'] },
    { name: 'Blender', gathers: ['#blender', '3d'] },
    { name: 'Dutch', gathers: [] },
  ];

  test('a tag in the Domain\'s gathers list claims the Piece', () => {
    expect(gatherers({ tags: ['essay', 'walking'], about: [] }, domains)).toEqual(['Cities']);
  });
  test('tags meet with or without the hash, any case', () => {
    expect(gatherers({ tags: ['#Blender'], about: [] }, domains)).toEqual(['Blender']);
    expect(gatherers({ tags: ['3D'], about: [] }, domains)).toEqual(['Blender']);
  });
  test('an about link claims the Piece even with no tag in common', () => {
    expect(gatherers({ tags: ['poem'], about: ['Dutch'] }, domains)).toEqual(['Dutch']);
  });
  test('a Piece can belong to several Domains', () => {
    expect(gatherers({ tags: ['cities', 'blender'], about: ['Dutch'] }, domains)).toEqual(['Cities', 'Blender', 'Dutch']);
  });
  test('no Domain: empty, so the self gathers it', () => {
    expect(gatherers({ tags: ['poem'], about: [] }, domains)).toEqual([]);
    expect(gatherers({ tags: [], about: [] }, [])).toEqual([]);
  });
  test('a Domain with an empty gathers list claims nothing by tag', () => {
    expect(gatherers({ tags: ['dutch'], about: [] }, domains)).toEqual([]);
  });
});

describe('normalizeTag', () => {
  test('strips the hash and lowers', () => {
    expect(normalizeTag('#Walking ')).toBe('walking');
    expect(normalizeTag('walking')).toBe('walking');
  });
});

describe('isRevisitable', () => {
  const { isRevisitable, isFinishedPiece } = require('../src/target');
  const app = (status: unknown) => ({
    metadataCache: { getFileCache: () => ({ frontmatter: status === undefined ? {} : { status } }) },
  });
  const piece = { path: 'Pieces/2021-x.md', basename: '2021-x', extension: 'md' };
  test('published and set-down are revisitable', () => {
    expect(isRevisitable(app('published'), piece)).toBe(true);
    expect(isRevisitable(app('set-down'), piece)).toBe(true);
  });
  test('a page is finished but never revisited', () => {
    expect(isFinishedPiece(app('page'), piece)).toBe(true);
    expect(isRevisitable(app('page'), piece)).toBe(false);
  });
  test('an open Piece is neither', () => {
    expect(isFinishedPiece(app(undefined), piece)).toBe(false);
    expect(isRevisitable(app(undefined), piece)).toBe(false);
  });
});
