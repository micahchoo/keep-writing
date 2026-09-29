// The offer that brings a new release's questions into banks the owner
// already has. It ASKS, with the count per bank, before anything is written:
// these are the owner's notes.

import { expect, test } from 'bun:test';
import { offerBankUpdate } from '../src/bank-modals';
import { installBank } from '../src/install';
import type { StarterNote } from '../src/install';
import { OfferModal } from '../src/modals';
import { fakeVault } from './fake-vault';

type Shown = { copy: { title: string; body: string[]; confirm: string }; onConfirm: () => void };

const V1: StarterNote = { name: 'learning.md', markdown: '---\nkind: bank\n---\n\n- what do you understand now? #register/knowledge ^kn-001\n' };
const V2 = (title = 'Learning') => ({
  ...V1,
  title,
  description: '',
  markdown: `${V1.markdown}- what did you learn by breaking it? #register/knowledge ^kn-002\n- what can your hands do now? #register/skill ^sk-001\n`,
});

async function withOffers(run: (shown: Shown[]) => Promise<void>): Promise<void> {
  const shown: Shown[] = [];
  const previous = OfferModal.prototype.open;
  OfferModal.prototype.open = function () { shown.push(this as unknown as Shown); };
  try { await run(shown); } finally { OfferModal.prototype.open = previous; }
}

test('it says how many questions each bank would gain, and writes nothing until confirmed', async () => {
  await withOffers(async (shown) => {
    const v = fakeVault({});
    await installBank(v.app, 'Bank', [V1]);
    const writes = v.writes.length;
    await offerBankUpdate(v.app, 'Bank', [V2()], { quiet: false });

    expect(shown).toHaveLength(1);
    expect(shown[0]?.copy.body.join('\n')).toContain('Learning: 2 new questions');
    expect(v.writes.length).toBe(writes);

    shown[0]?.onConfirm();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(v.text('Bank/learning.md')).toContain('^kn-002');
  });
});

// On load there is nothing to say when nothing is new; from the command, the
// owner asked, so silence would read as broken.
test('with nothing new, the quiet offer shows nothing', async () => {
  await withOffers(async (shown) => {
    const v = fakeVault({});
    await installBank(v.app, 'Bank', [V2()]);
    await offerBankUpdate(v.app, 'Bank', [V2()], { quiet: true });
    expect(shown).toHaveLength(0);
  });
});
