/** Relative Markdown note paths below the configured Bank folder. Zero disables a bank. */
export type BankWeights = Record<string, number>;

/** Starting proportions for the supplied banks; custom banks start at 10. */
export const DEFAULT_BANK_WEIGHTS: Readonly<BankWeights> = Object.freeze({
  'ordinary-life.md': 30,
  'autobiographical.md': 25,
  'autoethnographic.md': 20,
  'learning.md': 15,
  'invention.md': 10,
});

const CUSTOM_BANK_WEIGHT = 10;

function validBankKey(key: string): boolean {
  return key.trim() === key && /\.md$/i.test(key)
    && !/[\\:#|]/.test(key) && ![...key].some((character) => character.charCodeAt(0) < 32)
    && key.split('/').every((part) => part !== '' && part !== '.' && part !== '..'
      && part !== '__proto__' && part !== 'prototype' && part !== 'constructor');
}

/** The stable settings key for a bank note; empty for paths outside the folder. */
export function bankKey(path: string, bankFolder: string): string {
  const folder = bankFolder.replace(/\/+$/, '');
  const prefix = folder ? `${folder}/` : '';
  if (!path.startsWith(prefix)) return '';
  const key = path.slice(prefix.length);
  return validBankKey(key) ? key : '';
}

/** An explicit override, or the bank's starting proportion. Invalid paths are disabled. */
export function bankWeight(key: string, weights: BankWeights): number {
  if (!validBankKey(key)) return 0;
  const value: unknown = Object.getOwnPropertyDescriptor(weights, key)?.value;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  return DEFAULT_BANK_WEIGHTS[key] ?? CUSTOM_BANK_WEIGHT;
}

/** Keep valid persisted overrides, without filling or modifying the shared defaults. */
export function normalizeBankWeights(value: unknown): BankWeights {
  const weights: BankWeights = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return weights;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return weights;
  for (const key of Object.keys(value)) {
    if (!validBankKey(key)) continue;
    const weight: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
    if (typeof weight === 'number' && Number.isFinite(weight)) weights[key] = Math.max(0, Math.min(100, weight));
  }
  return weights;
}
