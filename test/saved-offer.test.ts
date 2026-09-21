import { describe, expect, test } from 'bun:test';
import { OFFER_SOURCE_MISSING, SavedOffer, offerSitting, readOffer } from '../src/saved-offer';
import type { FollowUpOffer } from '../src/saved-offer';
import { fakeVault } from './fake-vault';

const offer = (): FollowUpOffer => ({ sitting: 'Sittings/day.md', ref: { path: 'Sittings/day', blockId: 'a1' }, questions: ['What changed?', 'What remained?'] });

function kept(initial: FollowUpOffer | null = null) {
  const persisted: Array<FollowUpOffer | null> = [];
  const offers = new SavedOffer(initial, async (value) => { persisted.push(value); });
  return { offers, persisted };
}

describe('the saved Follow-up offer', () => {
  test('a question leaves the offer only once its Ask is written, and is persisted then', async () => {
    const shown = offer();
    const { offers, persisted } = kept(shown);
    let written = 0;
    expect(await offers.accept(shown, 'What changed?', async () => { written++; })).toBe(true);
    expect(written).toBe(1);
    expect(offers.current?.questions).toEqual(['What remained?']);
    expect(persisted).toEqual([{ ...shown, questions: ['What remained?'] }]);
  });

  test('accepting the same question twice writes once', async () => {
    const shown = offer();
    const { offers } = kept(shown);
    let written = 0;
    await offers.accept(shown, 'What changed?', async () => { written++; });
    expect(await offers.accept(shown, 'What changed?', async () => { written++; })).toBe(false);
    expect(written).toBe(1);
  });

  test('two clicks before the first write lands write once', async () => {
    const shown = offer();
    const { offers } = kept(shown);
    let release!: () => void;
    let written = 0;
    const first = offers.accept(shown, 'What changed?', () => new Promise<void>((resolve) => { release = () => { written++; resolve(); }; }));
    expect(await offers.accept(shown, 'What remained?', async () => { written++; })).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(written).toBe(1);
  });

  test('an offer shown before a newer one replaced it accepts nothing', async () => {
    const stale = offer();
    const { offers, persisted } = kept(stale);
    const fresh = { ...offer(), questions: ['What next?'] };
    await offers.replace(fresh);
    let written = 0;
    expect(await offers.accept(stale, 'What changed?', async () => { written++; })).toBe(false);
    expect(written).toBe(0);
    expect(offers.current).toBe(fresh);
    expect(persisted).toEqual([fresh]);
  });

  test('a replacement that cannot be persisted is still the current offer', async () => {
    const offers = new SavedOffer(null, async () => { throw new Error('disk full'); });
    const fresh = offer();
    await expect(offers.replace(fresh)).rejects.toThrow('disk full');
    expect(offers.current).toBe(fresh);
  });

  test('a write that fails leaves the question in the offer for another try', async () => {
    const shown = offer();
    const { offers, persisted } = kept(shown);
    await expect(offers.accept(shown, 'What changed?', async () => { throw new Error('vault closed'); })).rejects.toThrow('vault closed');
    expect(offers.current?.questions).toEqual(['What changed?', 'What remained?']);
    expect(persisted).toEqual([]);
    expect(await offers.accept(shown, 'What changed?', async () => {})).toBe(true);
  });
});

describe('where a saved offer lands', () => {
  test('the Sitting it names, when the answer block it cites is in the cache', () => {
    const v = fakeVault({ 'Sittings/day.md': '## Asked\n\nThe answer. ^a1\n' });
    const sitting = offerSitting(v.app, offer());
    expect(typeof sitting).not.toBe('string');
    expect((sitting as { path: string }).path).toBe('Sittings/day.md');
  });
  test('one line when the block is not there yet, and no Ask is inserted', () => {
    const v = fakeVault({ 'Sittings/day.md': '## Asked\n\nThe answer, not yet marked.\n' });
    expect(offerSitting(v.app, offer())).toBe(OFFER_SOURCE_MISSING);
    expect(offerSitting(v.app, { ...offer(), sitting: 'Sittings/gone.md' })).toBe(OFFER_SOURCE_MISSING);
  });
  test('what was stored is read back at the boundary, and anything else is null', () => {
    expect(readOffer(JSON.parse(JSON.stringify(offer())))).toEqual(offer());
    expect(readOffer({ sitting: 'x', ref: { path: 'x' }, questions: ['Question?'] })).toBeNull();
    expect(readOffer({ sitting: 'x', ref: { path: 'x', blockId: 'a' }, questions: [42] })).toBeNull();
    expect(readOffer(null)).toBeNull();
  });
});
