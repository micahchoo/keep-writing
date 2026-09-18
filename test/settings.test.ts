// The two pure halves of the settings tab. Neither had a test until
// 2026-09-17, and `parseFolders` is the function that decides whether the
// owner's corpus is reachable at all: hand it a trailing slash and the draw
// reaches nothing, silently, because `inFolders` compares `path + '/'`.

import { describe, expect, test } from 'bun:test';
import { isEndpoint, parseFolders } from '../src/settings';

describe('parseFolders', () => {
  test('one folder per line', () => {
    expect(parseFolders('Sittings\nPieces')).toEqual(['Sittings', 'Pieces']);
  });

  test('blank lines and whitespace are not folders', () => {
    expect(parseFolders('Sittings\n\n  \n  Pieces  \n')).toEqual(['Sittings', 'Pieces']);
  });

  test('slashes are stripped at both ends, kept in the middle', () => {
    expect(parseFolders('/Sittings/\nwriting/pieces/')).toEqual(['Sittings', 'writing/pieces']);
  });

  test('the same folder twice is one folder', () => {
    expect(parseFolders('Pieces\n/Pieces\nPieces/')).toEqual(['Pieces']);
  });

  test('nothing typed is no folders, not one empty one', () => {
    expect(parseFolders('')).toEqual([]);
    expect(parseFolders('\n/\n  ')).toEqual([]);
  });
});

describe('isEndpoint', () => {
  test('a URL the request can be made against', () => {
    expect(isEndpoint('http://127.0.0.1:8088/v1')).toBe(true);
    expect(isEndpoint('https://api.example.com/v1')).toBe(true);
    expect(isEndpoint('  http://localhost:1234/v1  ')).toBe(true);
  });

  test('anything the request cannot be made against', () => {
    expect(isEndpoint('')).toBe(false);
    expect(isEndpoint('127.0.0.1:8088')).toBe(false); // no scheme at all
    expect(isEndpoint('file:///etc/passwd')).toBe(false); // parses, but not something to POST to
    expect(isEndpoint('not a url')).toBe(false);
  });
});
