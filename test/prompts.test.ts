import { describe, expect, test } from 'bun:test';
import { followUpSystem, invitationSystem, revisitSystem } from '../src/bonsai';
import { CRAFT_LENS, FOLLOW_UP_LENS, INVITATION_LENS, STANCE } from '../src/lens';
import golden from './golden-prompts.json';

// A composer's prompt is two parts. The CONTRACT — what the reply looks like,
// what a question must be — is fixed, because code checks every reply against
// it and an owner who edited it away would see every reply refused, reported
// as the model having nothing to say. The STEER — who is asking, and where to
// look — is the owner's to edit: the Stance and the Lens.
//
// `golden-prompts.json` is the three prompts exactly as they were sent on
// 2026-09-29, before the Lens grew to hold the where-to-look list. The shipped
// defaults must compose them byte for byte, so widening what the owner can
// edit moved nothing that had been measured.

describe('the shipped defaults', () => {
  test('compose exactly the prompts measured before', () => {
    expect(followUpSystem({ stance: STANCE, lens: FOLLOW_UP_LENS })).toBe(golden.followUp);
    expect(revisitSystem({ stance: STANCE, lens: CRAFT_LENS })).toBe(golden.revisit);
    expect(invitationSystem(INVITATION_LENS)).toBe(golden.invitation);
  });
});

describe("the owner's steer", () => {
  const prose = 'Reply in prose, and ask anything you like.';

  test('replaces where to look, and never the contract', () => {
    for (const system of [
      followUpSystem({ stance: STANCE, lens: prose }),
      revisitSystem({ stance: STANCE, lens: prose }),
      invitationSystem(prose),
    ]) {
      expect(system.endsWith(prose)).toBe(true);
      expect(system).toContain('Reply with a JSON object and nothing else');
      expect(system).toContain('ending with "?"');
      expect(system).not.toContain('Where to look');
      expect(system).not.toContain('Where to find the concern');
    }
  });

  test('the Stance replaces only who is asking', () => {
    const system = followUpSystem({ stance: 'You are a patient oral historian.', lens: FOLLOW_UP_LENS });
    expect(system.startsWith('You are a patient oral historian. A person is being interviewed')).toBe(true);
    expect(system).not.toContain('autoethnographic');
  });
});
