import { describe, expect, test } from 'bun:test';
import { jarsLine } from '../src/view-ask';

describe('the pane header while roaming', () => {
  test('reports what is left in the two jars', () => {
    expect(jarsLine({ questions: 3980, paragraphs: 1102, wells: 9 })).toBe('roaming · 3980 questions · 1102 paragraphs across 9 wells');
  });
  test('singulars', () => {
    expect(jarsLine({ questions: 1, paragraphs: 1, wells: 1 })).toBe('roaming · 1 question · 1 paragraph across 1 well');
  });
});
