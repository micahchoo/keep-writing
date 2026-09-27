import { describe, expect, test } from 'bun:test';
import { DEFAULT_BANK_WEIGHTS, bankKey, bankWeight, normalizeBankWeights } from '../src/bank-mix';

describe('bank proportions', () => {
  test('supplied banks start at the intended proportions and custom banks at 10', () => {
    expect(DEFAULT_BANK_WEIGHTS).toEqual({
      'ordinary-life.md': 30,
      'autobiographical.md': 25,
      'autoethnographic.md': 20,
      'learning.md': 15,
      'invention.md': 10,
    });
    for (const [key, weight] of Object.entries(DEFAULT_BANK_WEIGHTS)) expect(bankWeight(key, {})).toBe(weight);
    expect(bankWeight('my-bank.md', {})).toBe(10);
    expect(bankWeight('custom/ordinary-life.md', {})).toBe(10);
  });

  test('an override of zero disables the bank and resetting restores its default', () => {
    expect(bankWeight('ordinary-life.md', { 'ordinary-life.md': 0 })).toBe(0);
    expect(bankWeight('ordinary-life.md', { 'ordinary-life.md': 45 })).toBe(45);
    expect(bankWeight('ordinary-life.md', {})).toBe(30);
  });

  test('keys preserve subfolders and extensions when the Bank folder moves', () => {
    expect(bankKey('Questions/Bank/ordinary-life.md', 'Questions/Bank')).toBe('ordinary-life.md');
    expect(bankKey('Questions/Bank/local/my bank.md', 'Questions/Bank/')).toBe('local/my bank.md');
    expect(bankKey('Questions/Banks/ordinary-life.md', 'Questions/Bank')).toBe('');
    expect(bankKey('Questions/Bank/../ordinary-life.md', 'Questions/Bank')).toBe('');
    expect(bankWeight('', {})).toBe(0);
  });

  test('persisted overrides are copied and clamped without filling in defaults', () => {
    const saved = { 'ordinary-life.md': 0, 'learning.md': 120, 'invention.md': -1, 'local/custom.md': 4.5 };
    const normalized = normalizeBankWeights(saved);
    expect(normalized).toEqual({ 'ordinary-life.md': 0, 'learning.md': 100, 'invention.md': 0, 'local/custom.md': 4.5 });
    normalized['ordinary-life.md'] = 12;
    expect(saved['ordinary-life.md']).toBe(0);
    expect(DEFAULT_BANK_WEIGHTS['ordinary-life.md']).toBe(30);
    expect(normalizeBankWeights(undefined)).toEqual({});
  });

  test('malformed values and paths cannot become settings', () => {
    expect(normalizeBankWeights({
      'ordinary-life.md': '30',
      'learning.md': Infinity,
      'invention.md': NaN,
      'null.md': null,
      'boolean.md': true,
      '../outside.md': 50,
      '/absolute.md': 50,
      'nested//bank.md': 50,
      './bank.md': 50,
      'no-extension': 50,
      'bank.md#^question': 50,
      'windows\\bank.md': 50,
      'constructor/bank.md': 50,
      'bank.md\n': 50,
      'valid.md': 25,
    })).toEqual({ 'valid.md': 25 });
    for (const invalid of [null, false, 10, '30', [], new Date()]) expect(normalizeBankWeights(invalid)).toEqual({});
  });

  test('prototype entries and accessors are never read as overrides', () => {
    const inherited: unknown = Object.create({ 'ordinary-life.md': 0 });
    expect(normalizeBankWeights(inherited)).toEqual({});
    expect(normalizeBankWeights(JSON.parse('{"__proto__":{"ordinary-life.md":0},"valid.md":20}'))).toEqual({ 'valid.md': 20 });
    const accessor = Object.defineProperty({}, 'ordinary-life.md', {
      enumerable: true,
      get() { throw new Error('A saved proportion must be data.'); },
    });
    expect(normalizeBankWeights(accessor)).toEqual({});
    const plain: Record<string, number> = Object.create(null) as Record<string, number>;
    plain['ordinary-life.md'] = 0;
    expect(normalizeBankWeights(plain)).toEqual({ 'ordinary-life.md': 0 });
  });
});
