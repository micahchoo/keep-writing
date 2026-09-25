// The pure halves of the settings tab. `readFolders` decides whether the
// owner's corpus is reachable at all: hand the draw a trailing slash and it
// reaches nothing, silently, because `inFolders` compares `path + '/'`.
//
// Folders are chosen from dropdowns since 2026-09-24, so nothing can be typed
// wrong any more. What is stored can still be: by an older version's
// textarea, or by hand in data.json. It is cleaned when it is read.

import { describe, expect, test } from 'bun:test';
import { folderOptions, isEndpoint, readFolders, withFolder, withoutFolder } from '../src/settings';

describe('readFolders', () => {
  test('a stored list, as it is', () => {
    expect(readFolders(['Sittings', 'Pieces'])).toEqual(['Sittings', 'Pieces']);
  });

  test('blank entries and whitespace are not folders', () => {
    expect(readFolders(['Sittings', '', '  ', '  Pieces  '])).toEqual(['Sittings', 'Pieces']);
  });

  test('slashes are stripped at both ends, kept in the middle', () => {
    expect(readFolders(['/Sittings/', 'writing/pieces/'])).toEqual(['Sittings', 'writing/pieces']);
  });

  test('the same folder twice is one folder', () => {
    expect(readFolders(['Pieces', '/Pieces', 'Pieces/'])).toEqual(['Pieces']);
  });

  test('anything that is not a list of names is no folders', () => {
    expect(readFolders(undefined)).toEqual([]);
    expect(readFolders('Pieces')).toEqual([]);
    expect(readFolders([3, null])).toEqual([]);
  });
});

describe('the folder dropdowns', () => {
  test('every folder in the vault, sorted, root left out', () => {
    expect(Object.keys(folderOptions(['Sittings', '/', 'Bank', 'Pieces/2021'], []))).toEqual(['Bank', 'Pieces/2021', 'Sittings']);
  });

  // The Bank folder does not exist until the starter bank is written, and a
  // dropdown that cannot show the current value shows a wrong one.
  test('a folder the setting names is offered even before it exists', () => {
    expect(Object.keys(folderOptions(['Sittings'], ['Bank', 'Sittings']))).toEqual(['Bank', 'Sittings']);
  });

  test('adding a folder already in the list changes nothing; removing takes it out', () => {
    expect(withFolder(['Sittings'], 'Pieces')).toEqual(['Sittings', 'Pieces']);
    expect(withFolder(['Sittings', 'Pieces'], 'Pieces')).toEqual(['Sittings', 'Pieces']);
    expect(withoutFolder(['Sittings', 'Pieces'], 'Sittings')).toEqual(['Pieces']);
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
