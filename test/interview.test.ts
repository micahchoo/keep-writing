// The Interview, driven through its own interface: one Sitting's worth.
//
// Every fixture here holds exactly ONE drawable source unless the test is
// about several, so a draw is deterministic without the Interview having to
// take a random seam it would never use in the vault.

import { describe, expect, test } from 'bun:test';
import { parseAsks } from '../src/asks';
import type { Ask } from '../src/asks';
import { AnsweredIndex } from '../src/bank';
import type { Model, RevisitCandidate } from '../src/model';
import { Interview } from '../src/interview';
import type { InterviewHost } from '../src/interview';
import type { Paragraph } from '../src/paragraphs';
import { DEFAULT_SETTINGS } from '../src/settings';
import { fakeVault } from './fake-vault';
import type { VaultHooks } from './fake-vault';

// ---------------------------------------------------------------------------
// The two adapters the Interview needs

interface Plan {
  revisit?: RevisitCandidate[];
  invitation?: RevisitCandidate[];
  followUps?: string[];
}

function recordingModel(plan: Plan = {}) {
  const seen = {
    revisit: [] as { paragraph: string; framing: string; asked: string[]; lens: string }[],
    invitation: [] as { paragraph: string; asked: string[]; lens: string }[],
    followUp: [] as { question: string; answer: string; asked: string[]; target: string }[],
  };
  const model: Model = {
    available: true,
    reason: '',
    composeRevisit: async (paragraph, framing, asked, lens) => {
      seen.revisit.push({ paragraph, framing, asked, lens });
      return plan.revisit ?? [];
    },
    composeInvitation: async (paragraph, asked, lens) => {
      seen.invitation.push({ paragraph, asked, lens });
      return plan.invitation ?? [];
    },
    composeFollowUps: async (question, answer, asked, target) => {
      seen.followUp.push({ question, answer, asked, target });
      return plan.followUps ?? [];
    },
  };
  return { model, seen };
}

const OFF: Model = {
  available: false,
  reason: 'model switched off in settings',
  composeRevisit: async () => [],
  composeInvitation: async () => [],
  composeFollowUps: async () => [],
};

function open(notes: Record<string, string>, model: Model = OFF, hooks: VaultHooks = {}) {
  const v = fakeVault(notes, hooks);
  const surface = {
    cursors: [] as { path: string; line: number }[],
    notices: [] as string[],
    /** Whether the owner is looking at the note an Ask lands in. */
    landing: true,
  };
  const host: InterviewHost = {
    app: v.app,
    // The folders this test vault keeps writing in. The shipped default names
    // only the Sittings folder; every fixture here that holds a Piece says so.
    settings: { ...DEFAULT_SETTINGS, writingFolders: ['Sittings', 'Pieces'] },
    index: new AnsweredIndex(v.app),
    model,
  };
  const interview = new Interview(host, {
    placeCursor: (file, line) => {
      if (!surface.landing) return false;
      surface.cursors.push({ path: file.path, line });
      return true;
    },
    notice: (message) => surface.notices.push(message),
  });
  // In the vault the plugin invalidates on every metadataCache event; here the
  // test says when the index should notice a write.
  return { v, interview, surface, host, refresh: () => host.index.invalidate() };
}

const asksIn = (v: ReturnType<typeof fakeVault>, path: string): Ask[] => parseAsks(v.text(path));

// ---------------------------------------------------------------------------
// Fixtures: one drawable source each

const TODAY = 'Sittings/2026-09-15.md';
const EMPTY_SITTING = '---\n---\n\n## Asked\n\n';

const bankOnly = () => ({
  [TODAY]: EMPTY_SITTING,
  'Bank/craft.md': '---\nkind: bank\n---\n\n- what did you make? #register/episode ^b1\n',
});

const PARAGRAPH = 'I rig characters badly and the hips always break when the walk cycle turns a corner.';

/** One drawable paragraph, in the only two shelves the jar has: a Piece. */
const paragraphOnly = () => ({
  [TODAY]: EMPTY_SITTING,
  'Pieces/rigging.md': `---\ntitle: Rigging\nstatus: published\ndate: 2021-03-04\n---\n\n${PARAGRAPH} ^p-001\n`,
  'Lenses/craft.md': '---\nkind: lens\n---\n\nAsk for a time it went wrong.\n',
  'Lenses/invitation.md': '---\nkind: lens\n---\n\nThe paragraph is a seed, not a subject.\n',
});

const ANSWERED = 'The hips broke because I weighted the pelvis to the wrong bone entirely.';

/** Yesterday's Sitting holds one answered block; today's is the one being drawn for. */
const sittingBlock = () => ({
  [TODAY]: EMPTY_SITTING,
  'Sittings/2026-09-14.md': [
    '---',
    'answers:',
    '  - "[[Bank/craft#^b1]]"',
    '---',
    '',
    '## Asked',
    '',
    '> [!ask] what broke in the rig?',
    '> from [[Bank/craft#^b1]]',
    '',
    `${ANSWERED} ^y1`,
    '',
  ].join('\n'),
  'Bank/craft.md': '---\nkind: bank\n---\n\n- what broke in the rig? #register/episode ^b1\n',
});

/** The one paragraph a draw found, for the tests that go on to compose about it. */
async function drawnParagraph(interview: Interview, sitting: Parameters<Interview['draw']>[0]): Promise<Paragraph> {
  const { drawn } = await interview.draw(sitting);
  const source = drawn[0]?.source;
  if (!source || source.kind !== 'paragraph') throw new Error('fixture drew no paragraph');
  return source;
}

// ---------------------------------------------------------------------------

describe('the draw', () => {
  test('reports what the two jars held', async () => {
    const { v, interview } = open(bankOnly());
    const drawing = await interview.draw(v.file(TODAY));
    expect(drawing.drawn).toHaveLength(1);
    expect(drawing.drawn[0]?.source.kind).toBe('question');
    expect(drawing.jars).toEqual({ questions: 1, paragraphs: 0 });
    expect(drawing.target).toBeNull();
  });

  // Several at once is what lets Escape be the refusal: no `skipped` set has
  // to outlive the choosing.
  test('several at once, and never the same source twice', async () => {
    const { v, interview } = open({
      [TODAY]: EMPTY_SITTING,
      'Bank/craft.md':
        '---\nkind: bank\n---\n\n- one? #register/episode ^b1\n- two? #register/episode ^b2\n- three? #register/episode ^b3\n',
    });
    const { drawn } = await interview.draw(v.file(TODAY), 3);
    expect(new Set(drawn.map((d) => d.source.key)).size).toBe(3);
  });

  test('asking for more than there is hands back what there is', async () => {
    const { v, interview } = open(bankOnly());
    expect((await interview.draw(v.file(TODAY), 8)).drawn).toHaveLength(1);
  });

  test('a Target is read off the Sitting and narrows the jar to that note', async () => {
    const notes = paragraphOnly();
    notes[TODAY] = '---\nabout: "[[Pieces/rigging]]"\n---\n\n## Asked\n\n';
    const { v, interview } = open(notes);
    const drawing = await interview.draw(v.file(TODAY));
    expect(drawing.target).toBe('rigging');
    expect(drawing.jars.questions).toBe(0);
    expect(drawing.drawn[0]?.source.kind).toBe('paragraph');
  });

  test('accepting writes the Ask, cites its source, and puts the cursor under it', async () => {
    const { v, interview, surface } = open(bankOnly());
    const sitting = v.file(TODAY);
    const { drawn } = await interview.draw(sitting);
    await interview.accept(sitting, drawn[0] as (typeof drawn)[number]);

    const asks = asksIn(v, TODAY);
    expect(asks).toHaveLength(1);
    expect(asks[0]?.question).toBe('what did you make?');
    expect(asks[0]?.sourceRef).toBe('Bank/craft#^b1');
    // The cursor waits inside the answer's own range, under the callout.
    const at = surface.cursors.at(-1) as { path: string; line: number };
    expect(at.path).toBe(TODAY);
    expect(at.line).toBeGreaterThanOrEqual(asks[0]?.answer.start as number);
    expect(at.line).toBeLessThan(asks[0]?.answer.end as number);
  });

  test('a question already asked in this Sitting never comes back', async () => {
    const { v, interview } = open(bankOnly());
    const sitting = v.file(TODAY);
    const { drawn } = await interview.draw(sitting);
    await interview.accept(sitting, drawn[0] as (typeof drawn)[number]);
    expect((await interview.draw(sitting)).drawn).toEqual([]);
  });

  test('an answered question is out of the jar', async () => {
    const notes = bankOnly();
    notes[TODAY] = '---\nanswers:\n  - "[[Bank/craft#^b1]]"\n---\n\n## Asked\n\n';
    const { v, interview } = open(notes);
    const drawing = await interview.draw(v.file(TODAY));
    expect(drawing.drawn).toEqual([]);
    expect(drawing.jars.questions).toBe(0);
  });
});

// Who chose the paragraph decides everything about what is asked of it.
const PICK_UP = 'I want to get back to the rig and find out why the pelvis weighting went wrong.';

/**
 * Yesterday the owner answered the Bookmark, so `next` on `me` points at what
 * they wrote. `Bank/closing`'s only entry carries a Role, so the Bank jar is
 * empty and every row a draw finds here is the paragraph jar's.
 */
const bookmarked = (next = '[[Sittings/2026-09-14#^y1]]'): Record<string, string> => ({
  [TODAY]: EMPTY_SITTING,
  'me.md': `---\nnext: "${next}"\n---\n\nThe self.\n`,
  'Sittings/2026-09-14.md': [
    '---',
    'answers:',
    '  - "[[Bank/closing#^bm1]]"',
    '---',
    '',
    '## Asked',
    '',
    '> [!ask] where should we pick up?',
    '> from [[Bank/closing#^bm1]]',
    '',
    `${PICK_UP} ^y1`,
    '',
  ].join('\n'),
  'Bank/closing.md':
    '---\nkind: bank\n---\n\n- where should we pick up? #register/intention #role/bookmark ^bm1\n',
});

// ---------------------------------------------------------------------------

describe('the pick-up', () => {
  // `next` was written by the Bookmark and read by NOTHING until 2026-09-17.
  // The owner kept the Bookmark on this condition: "I can see how something
  // like what we should pick up on tomorrow might be useful if the model
  // actually ends up using it."
  test('what the owner said to pick up is the first row, and it says so', async () => {
    const { v, interview } = open(bookmarked());
    const { drawn } = await interview.draw(v.file(TODAY));
    expect(drawn[0]?.pickUp).toBe(true);
    expect(drawn[0]?.source.key).toBe('Sittings/2026-09-14.md#^y1');
    expect(drawn[0]?.source.text).toBe(PICK_UP);
  });

  test('it takes one of the rows, never an extra one', async () => {
    const notes = bookmarked();
    notes['Bank/craft.md'] =
      '---\nkind: bank\n---\n\n- one? #register/episode ^b1\n- two? #register/episode ^b2\n- three? #register/episode ^b3\n';
    const { v, interview } = open(notes);
    const { drawn } = await interview.draw(v.file(TODAY), 3);
    expect(drawn).toHaveLength(3);
    expect(drawn[0]?.pickUp).toBe(true);
    expect(drawn.slice(1).every((d) => d.pickUp === undefined)).toBe(true);
  });

  // It sits in the paragraph jar too, and a draw that offered it twice would
  // spend two of three rows on one paragraph.
  test('the jar cannot hand back the same paragraph', async () => {
    const { v, interview } = open(bookmarked());
    const { drawn, jars } = await interview.draw(v.file(TODAY), 3);
    expect(new Set(drawn.map((d) => d.source.key)).size).toBe(drawn.length);
    expect(drawn).toHaveLength(1);
    // And the counts are honest about it: the pick-up left the jar.
    expect(jars.paragraphs).toBe(0);
  });

  test('followed, it stops coming back: an answer linked to it is enough', async () => {
    const notes = bookmarked();
    notes['Sittings/2026-09-16.md'] =
      '---\nanswers:\n  - "[[Sittings/2026-09-14#^y1]]"\n---\n\n## Asked\n\nI re-weighted it. ^z1\n';
    const { v, interview } = open(notes);
    const { drawn } = await interview.draw(v.file(TODAY));
    expect(drawn.every((d) => d.pickUp === undefined)).toBe(true);
  });

  // The Bookmark answered THIS Sitting names an edge the owner has not walked
  // away from yet. The jar holds today's own blocks out for the same reason.
  test('a Bookmark answered today is not offered back the same day', async () => {
    const notes = bookmarked('[[Sittings/2026-09-15#^t1]]');
    notes[TODAY] = `---\n---\n\n## Asked\n\n${PICK_UP} ^t1\n`;
    const { v, interview } = open(notes);
    const { drawn } = await interview.draw(v.file(TODAY));
    expect(drawn.every((d) => d.pickUp === undefined)).toBe(true);
  });

  test('no Bookmark answered yet, no pick-up row', async () => {
    const notes = bookmarked();
    notes['me.md'] = '---\n---\n\nThe self.\n';
    const { v, interview } = open(notes);
    const { drawn } = await interview.draw(v.file(TODAY));
    expect(drawn.every((d) => d.pickUp === undefined)).toBe(true);
  });

  // A ref written into a property days ago outlives the text it named.
  test('a `next` whose block is gone offers nothing, and refuses nothing either', async () => {
    const { v, interview, surface } = open(bookmarked('[[Sittings/2026-09-14#^gone]]'));
    const { drawn } = await interview.draw(v.file(TODAY));
    expect(drawn.every((d) => d.pickUp === undefined)).toBe(true);
    expect(surface.notices).toHaveLength(0);
  });

  // `next` lands on the Target when the day has one (closing.ts#writeBookmark);
  // both ends ask the same question, so both find the same note.
  test('with a Target set, the pick-up is read off the Target', async () => {
    const notes = bookmarked();
    notes['me.md'] = '---\n---\n\nThe self.\n';
    notes['Pieces/rigging.md'] =
      '---\ntitle: Rigging\nstatus: published\ndate: 2021-03-04\nnext: "[[Sittings/2026-09-14#^y1]]"\n---\n\nA published line. ^p-001\n';
    notes[TODAY] = '---\nabout: "[[Pieces/rigging]]"\n---\n\n## Asked\n\n';
    const { v, interview } = open(notes);
    const { drawn } = await interview.draw(v.file(TODAY), 3);
    expect(drawn[0]?.pickUp).toBe(true);
    expect(drawn[0]?.source.key).toBe('Sittings/2026-09-14.md#^y1');
  });
});

// ---------------------------------------------------------------------------

describe('the seed — a Sitting is never born blank', () => {
  test('one Bank question, and no model call on the way', async () => {
    const { model, seen } = recordingModel({ followUps: ['never asked'] });
    const { v, interview } = open(bankOnly(), model);
    expect(await interview.seed(v.file(TODAY))).toBe(true);

    const asks = asksIn(v, TODAY);
    expect(asks).toHaveLength(1);
    expect(asks[0]?.question).toBe('what did you make?');
    expect(asks[0]?.sourceRef).toBe('Bank/craft#^b1');
    expect(seen.revisit).toHaveLength(0);
    expect(seen.invitation).toHaveLength(0);
    expect(seen.followUp).toHaveLength(0);
  });

  // The shape `Templates/Sitting.md` actually makes. A note-wide "does it
  // hold an Ask?" check reads the Closing move the template carried in and
  // never seeds anything — measured against the real template, 2026-09-17.
  test('a Sitting born from the template is seeded, Closing move and all', async () => {
    const { v, interview } = open({
      [TODAY]: '## Asked\n\n## Closing\n\n> [!ask] where should we pick up?\n> from [[Bank/closing#^x1]]\n',
      'Bank/craft.md': '---\nkind: bank\n---\n\n- what did you make? #register/episode ^b1\n',
      'Bank/closing.md':
        '---\nkind: bank\n---\n\n- where should we pick up? #register/intention #role/bookmark ^x1\n',
    });
    expect(await interview.seed(v.file(TODAY))).toBe(true);

    const asks = asksIn(v, TODAY);
    expect(asks.map((a) => a.question)).toEqual(['what did you make?', 'where should we pick up?']);
    // And the Closing move stays at the END: the seed lands above its heading.
    expect(v.text(TODAY).indexOf('what did you make?')).toBeLessThan(v.text(TODAY).indexOf('## Closing'));
  });

  test('a Sitting whose Asked section already holds one is left exactly as it was', async () => {
    const { v, interview } = open(bankOnly());
    const sitting = v.file(TODAY);
    expect(await interview.seed(sitting)).toBe(true);
    const seeded = v.text(TODAY);
    expect(await interview.seed(sitting)).toBe(false);
    expect(v.text(TODAY)).toBe(seeded);
  });

  test('an empty Bank writes nothing rather than an empty Ask', async () => {
    const { v, interview } = open({ [TODAY]: EMPTY_SITTING });
    expect(await interview.seed(v.file(TODAY))).toBe(false);
    expect(v.text(TODAY)).toBe(EMPTY_SITTING);
  });

  // A Bank entry with a Role is carried into the Sitting by the template.
  test('a Closing move is never the seed', async () => {
    const { v, interview } = open(bookmarked());
    expect(await interview.seed(v.file(TODAY))).toBe(false);
  });

  // A Target closes the Bank jar, and the seed will not reach for the model
  // to compose from a paragraph. The day stays as the owner set it.
  test('a Target closes the Bank, so nothing is seeded', async () => {
    const notes: Record<string, string> = bankOnly();
    notes[TODAY] = '---\nabout: "[[Pieces/rigging]]"\n---\n\n## Asked\n\n';
    notes['Pieces/rigging.md'] = '---\ntitle: Rigging\nstatus: published\n---\n\nA line. ^p-001\n';
    const { v, interview } = open(notes);
    expect(await interview.seed(v.file(TODAY))).toBe(false);
  });

  test('a due on the entry carries into the seeded Ask', async () => {
    const { v, interview } = open({
      [TODAY]: EMPTY_SITTING,
      'Bank/craft.md': '---\nkind: bank\n---\n\n- state your model so far #register/knowledge due: 2026-12-01 ^b1\n',
    });
    expect(await interview.seed(v.file(TODAY))).toBe(true);
    expect(asksIn(v, TODAY)[0]?.due).toBe('2026-12-01');
  });

  test('a Sitting with no `## Asked` heading gets one', async () => {
    const { v, interview } = open({
      'Sittings/2026-09-15.md': '',
      'Bank/craft.md': '---\nkind: bank\n---\n\n- what did you make? #register/episode ^b1\n',
    });
    expect(await interview.seed(v.file(TODAY))).toBe(true);
    expect(v.text(TODAY)).toContain('## Asked');
    expect(asksIn(v, TODAY)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('the Invitation — the draw found it', () => {
  test('the paragraph seeds the question, with NO framing and the invitation Lens', async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(paragraphOnly(), model);
    const paragraph = await drawnParagraph(interview, v.file(TODAY));
    const offer = await interview.offerFrom(paragraph, 'picked');

    expect(seen.invitation).toHaveLength(1);
    expect(seen.revisit).toHaveLength(0);
    expect(seen.invitation[0]?.paragraph).toBe(PARAGRAPH);
    expect(seen.invitation[0]?.lens).toBe('The paragraph is a seed, not a subject.');
    expect(offer.lens).toBe('invitation');
  });

  // The framing is what stops a Revisit reading as random. It is what would
  // make an Invitation read as a question about 2021.
  test('the framing is not sent at all: there is nowhere to put it', async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(paragraphOnly(), model);
    await interview.offerFrom(await drawnParagraph(interview, v.file(TODAY)), 'picked');
    expect(Object.keys(seen.invitation[0] ?? {})).not.toContain('framing');
  });

  test('a Sitting block still carries the question it answered into the Asked set', async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(sittingBlock(), model);
    await interview.offerFrom(await drawnParagraph(interview, v.file(TODAY)), 'picked');
    // Without this the draw could hand back the question that made the block.
    expect(seen.invitation[0]?.asked).toEqual(['what broke in the rig?']);
  });

  // Showing the 2020 prose under a question about now undoes the work.
  test('accepting cites the paragraph and does NOT embed it', async () => {
    const { model } = recordingModel({ invitation: [{ question: 'what do you keep repairing?' }] });
    const { v, interview } = open(paragraphOnly(), model);
    const sitting = v.file(TODAY);
    const paragraph = await drawnParagraph(interview, sitting);
    await interview.acceptFrom(sitting, paragraph, { question: 'what do you keep repairing?' }, 'picked');

    const written = v.text(TODAY);
    expect(written).toContain('> [!ask] what do you keep repairing?');
    expect(written).toContain('> from [[Pieces/rigging#^p-001]]');
    expect(written).not.toContain('![[Pieces/rigging#^p-001]]');
  });
});

describe('the Revisit — the owner pointed at it', () => {
  test('the paragraph is interviewed, with its framing and the craft Lens', async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(paragraphOnly(), model);
    const paragraph = await drawnParagraph(interview, v.file(TODAY));
    const offer = await interview.offerFrom(paragraph, 'pointed');

    expect(seen.revisit).toHaveLength(1);
    expect(seen.invitation).toHaveLength(0);
    expect(seen.revisit[0]?.framing).toBe('in 2021, in "Rigging"');
    expect(seen.revisit[0]?.lens).toBe('Ask for a time it went wrong.');
    expect(offer.lens).toBe('craft');
  });

  test('a paragraph from a Piece has no Asked set, and says so by being empty', async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(paragraphOnly(), model);
    await interview.offerFrom(await drawnParagraph(interview, v.file(TODAY)), 'pointed');
    expect(seen.revisit[0]?.asked).toEqual([]);
  });

  test('accepting embeds the paragraph under the Ask, so it reads in place', async () => {
    const { model } = recordingModel({ revisit: [{ question: 'which corner broke it first?' }] });
    const { v, interview } = open(paragraphOnly(), model);
    const sitting = v.file(TODAY);
    const paragraph = await drawnParagraph(interview, sitting);
    await interview.acceptFrom(sitting, paragraph, { question: 'which corner broke it first?' }, 'pointed');

    const written = v.text(TODAY);
    expect(written).toContain('> from [[Pieces/rigging#^p-001]]');
    expect(written).toContain('> ![[Pieces/rigging#^p-001]]');
  });

  // The jar only reaches blocks that already carry an id. A paragraph without
  // one is reached by pointing at it, and gets its id when the Ask is written.
  test('a paragraph with no id is given one so the Ask can cite it', async () => {
    const { v, interview } = open({
      [TODAY]: EMPTY_SITTING,
      'Anywhere/notebook.md': `---\n---\n\n${PARAGRAPH}\n`,
    });
    const sitting = v.file(TODAY);
    const picked = interview.selection({
      file: v.file('Anywhere/notebook.md'),
      selected: PARAGRAPH,
      line: 3,
    }) as Paragraph;
    await interview.acceptFrom(sitting, picked, { question: 'which corner broke it first?' }, 'pointed');

    const id = /\^([a-z0-9]{6})/.exec(v.text('Anywhere/notebook.md'))?.[1];
    expect(id).toBeDefined();
    expect(v.text(TODAY)).toContain(`> from [[Anywhere/notebook#^${id}]]`);
  });
});

describe('either way', () => {
  test('with the model off the offer is empty, so the caller shows the one fixed fallback', async () => {
    const { v, interview } = open(paragraphOnly());
    expect((await interview.offerFrom(await drawnParagraph(interview, v.file(TODAY)), 'picked')).candidates).toEqual([]);
    expect((await interview.offerFrom(await drawnParagraph(interview, v.file(TODAY)), 'pointed')).candidates).toEqual([]);
  });

  // Nothing asks for a due marker today. A Lens is prose the owner edits, so
  // any Lens can start; the mechanism stays.
  test('a due marker on the candidate becomes a due line on the Ask', async () => {
    const { v, interview } = open(paragraphOnly());
    const sitting = v.file(TODAY);
    const paragraph = await drawnParagraph(interview, sitting);
    await interview.acceptFrom(sitting, paragraph, { question: 'can you rig one by Friday?', dueDays: 7 }, 'picked');
    expect(v.text(TODAY)).toMatch(/> due: \d{4}-\d{2}-\d{2}/);
  });
});

describe('answering', () => {
  const answered = () => ({
    [TODAY]: [
      '---',
      '---',
      '',
      '## Asked',
      '',
      '> [!ask] what broke in the rig?',
      '> from [[Bank/craft#^b1]]',
      '',
      ANSWERED,
      '',
      '> [!ask] what else did you try?',
      '> from [[Bank/craft#^b2]]',
      '',
    ].join('\n'),
    'Bank/craft.md':
      '---\nkind: bank\n---\n\n- what broke in the rig? #register/episode ^b1\n- what else did you try? #register/episode ^b2\n',
    'Pieces/cities.md': `---\ntitle: Cities\nstatus: published\n---\n\nThe pelvis bone was weighted wrong in every rig I made that year. ^p-004\n`,
  });

  test('marking links the answer at birth, then asks bonsai what follows', async () => {
    const { model, seen } = recordingModel({ followUps: ['which bone did you weight it to?'] });
    const { v, interview, surface } = open(answered(), model);
    const marked = await interview.markAt({ file: v.file(TODAY), line: 8 });

    expect(surface.notices).toContain('Answer linked.');
    expect(v.frontmatter(TODAY)['answers']).toEqual(['[[Bank/craft#^b1]]']);

    // The Follow-up is measured against every other question this Sitting put.
    expect(seen.followUp[0]?.question).toBe('what broke in the rig?');
    expect(seen.followUp[0]?.answer).toBe(ANSWERED);
    expect(seen.followUp[0]?.asked).toEqual(['what else did you try?']);
    expect(seen.followUp[0]?.target).toBe('me');

    expect(marked?.questions).toEqual(['which bone did you weight it to?']);
  });

  test('accepting a Follow-up writes it as an Ask citing the answer block', async () => {
    const { model } = recordingModel({ followUps: ['which bone did you weight it to?'] });
    const { v, interview } = open(answered(), model);
    const sitting = v.file(TODAY);
    const marked = await interview.markAt({ file: sitting, line: 8 });
    await interview.acceptFollowUp(sitting, marked?.questions[0] as string, marked?.ref as NonNullable<typeof marked>['ref']);

    const id = /\^([a-z0-9]{6})/.exec(v.text(TODAY))?.[1];
    expect(v.text(TODAY)).toContain('> [!ask] which bone did you weight it to?');
    expect(v.text(TODAY)).toContain(`> from [[Sittings/2026-09-15#^${id}]]`);
  });

  test('with the model off, marking still links the answer and asks nothing', async () => {
    const { v, interview } = open(answered());
    const marked = await interview.markAt({ file: v.file(TODAY), line: 8 });
    expect(v.frontmatter(TODAY)['answers']).toEqual(['[[Bank/craft#^b1]]']);
    expect(marked?.questions).toEqual([]);
  });

  // The Closing move itself is closing.ts's, and test/closing.test.ts holds it
  // at that interface. This is the CHAINING: marking runs it. It lived inside
  // markAnswered until 2026-09-17, where a callout parser had to know what a
  // Bank Role was.
  test('marking a Bookmark answer writes `next` on the Sitting’s Target', async () => {
    const { v, interview } = open({
      [TODAY]: [
        '---',
        'about: "[[Blender]]"',
        '---',
        '',
        '## Asked',
        '',
        '> [!ask] where should we pick up?',
        '> from [[Bank/closing#^bm1]]',
        '',
        'With the hips. That is where it broke.',
        '',
      ].join('\n'),
      'Domains/Blender.md': '---\ngathers: [blender]\n---\n\nI rig badly.\n',
      'Bank/closing.md':
        '---\nkind: bank\n---\n\n- where should we pick up? #register/intention #role/bookmark ^bm1\n',
    });
    await interview.markAt({ file: v.file(TODAY), line: 9 });
    expect(v.frontmatter('Domains/Blender.md')['next']).toMatch(/^\[\[Sittings\/2026-09-15#\^/);
  });

  // The command's half: the note and the line, read where the editor still
  // holds them. This lived in main.ts until 2026-09-16 and no test could reach
  // any of it.
  describe('every way marking refuses', () => {
    test('a note that is not a Sitting refuses, and writes nothing', async () => {
      const { v, interview, surface } = open(answered());
      expect(await interview.markAt({ file: v.file('Pieces/cities.md'), line: 5 })).toBeNull();
      expect(surface.notices).toEqual(['The active note is not a Sitting.']);
      expect(v.writes).toHaveLength(0);
    });

    test('a line under no Ask refuses, and writes nothing', async () => {
      const { v, interview, surface } = open(answered());
      expect(await interview.markAt({ file: v.file(TODAY), line: 3 })).toBeNull();
      expect(surface.notices).toEqual(['The cursor is not under an Ask.']);
      expect(v.writes).toHaveLength(0);
    });

    // NOT a refusal. Running it again on a linked answer is how the owner asks
    // for another Follow-up: the chooser does not persist, so without this the
    // questions were reachable exactly once, in the seconds after marking.
    test('an answer already linked is marked again, writes nothing, and composes afresh', async () => {
      const { model, seen } = recordingModel({ followUps: ['which bone did you weight it to?'] });
      const { v, interview, surface } = open(answered(), model);
      await interview.markAt({ file: v.file(TODAY), line: 8 });
      const before = v.text(TODAY);
      // The frontmatter write moved every body line down; find the answer again.
      const moved = (parseAsks(v.text(TODAY))[0] as Ask).firstParagraph?.start as number;

      const again = await interview.markAt({ file: v.file(TODAY), line: moved });

      expect(again?.questions).toEqual(['which bone did you weight it to?']);
      expect(seen.followUp).toHaveLength(2);
      // Nothing CHANGES the second time: the block keeps the id it has and
      // `answers` keeps the one entry. (`processFrontMatter` is still called,
      // and still re-serialises; it just has nothing to add.)
      expect(v.text(TODAY)).toBe(before);
      expect(v.frontmatter(TODAY)['answers']).toEqual(['[[Bank/craft#^b1]]']);
      // And it is not announced twice.
      expect(surface.notices).toEqual(['Answer linked.']);
    });

    // markAnswered hands back the reason; this is the Surface saying it.
    test('an Ask with nothing written under it refuses in the owner’s words', async () => {
      const { v, interview, surface } = open(answered());
      expect(await interview.markAt({ file: v.file(TODAY), line: 12 })).toBeNull();
      expect(surface.notices).toEqual(['No answer under this Ask yet.']);
      expect(v.writes).toHaveLength(0);
    });
  });
});

describe('asking about a selection', () => {
  const reading = () => ({
    [TODAY]: EMPTY_SITTING,
    'Pieces/cities.md': `---\ntitle: Cities\nstatus: published\ndate: 2021-03-04\n---\n\n${PARAGRAPH} ^p-004\n`,
  });

  test('words with no prose in them are refused, and the reason is said once', async () => {
    const { v, interview, surface } = open(reading());
    expect(interview.selection({ file: v.file('Pieces/cities.md'), selected: '![a map](map.png)', line: 6 })).toBeNull();
    expect(surface.notices).toEqual(['That selection is a link, an image or markup. Select words to ask about.']);
    expect(v.writes).toHaveLength(0);
  });

  test('a selection becomes the source, framed by the note it sits in', async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(reading(), model);
    const picked = interview.selection({
      file: v.file('Pieces/cities.md'),
      selected: 'the hips always break',
      line: 6,
    });
    await interview.offerFrom(picked as Paragraph, 'pointed');
    expect(seen.revisit[0]?.paragraph).toBe('the hips always break');
    expect(seen.revisit[0]?.framing).toBe('in 2021, in "Cities"');
  });

  test("the jar's word floor does not apply: what the owner points at, they meant", async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(reading(), model);
    const picked = interview.selection({ file: v.file('Pieces/cities.md'), selected: 'the hips', line: 6 });
    await interview.offerFrom(picked as Paragraph, 'pointed');
    expect(seen.revisit[0]?.paragraph).toBe('the hips');
  });

  test('a selection read outside a Sitting lands its Ask in today’s Sitting', async () => {
    const { v, interview, surface } = open({
      'Sittings/2026-09-13.md': EMPTY_SITTING,
      'Pieces/cities.md': reading()['Pieces/cities.md'] as string,
    });
    const piece = v.file('Pieces/cities.md');
    const picked = interview.selection({ file: piece, selected: 'the hips always break', line: 6 });
    // `moment()` is fixed at 2026-09-13 in the test harness; the owner is
    // reading the Piece, so the cursor cannot land in the Sitting.
    const sitting = await interview.sitting(piece);
    surface.landing = false;
    await interview.acceptFrom(sitting, picked as Paragraph, { question: 'which corner broke it first?' }, 'pointed');

    expect(v.text('Sittings/2026-09-13.md')).toContain('> [!ask] which corner broke it first?');
    expect(surface.notices).toContain('Asked in 2026-09-13.');
  });
});
