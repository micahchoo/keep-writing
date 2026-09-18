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
  followUps?: string[];
}

function recordingModel(plan: Plan = {}) {
  const seen = {
    revisit: [] as { paragraph: string; framing: string; asked: string[]; lens: string }[],
    followUp: [] as { question: string; answer: string; asked: string[]; target: string }[],
  };
  const model: Model = {
    available: true,
    reason: '',
    composeRevisit: async (paragraph, framing, asked, lens) => {
      seen.revisit.push({ paragraph, framing, asked, lens });
      return plan.revisit ?? [];
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
    settings: { ...DEFAULT_SETTINGS },
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

const paragraphOnly = () => ({
  [TODAY]: EMPTY_SITTING,
  'Domains/Blender.md': `---\ngathers: [blender]\n---\n\n${PARAGRAPH}\n`,
  'Lenses/craft.md': '---\nkind: lens\nfor: domain\n---\n\nAsk for a time it went wrong.\n',
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
    expect(drawing.jars).toEqual({ questions: 1, paragraphs: 0, wells: 0 });
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

  test('a Target is read off the Sitting and narrows the jar', async () => {
    const notes = paragraphOnly();
    notes[TODAY] = '---\nabout: "[[Blender]]"\n---\n\n## Asked\n\n';
    const { v, interview } = open(notes);
    const drawing = await interview.draw(v.file(TODAY));
    expect(drawing.target).toBe('Blender');
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

describe('the Revisit', () => {
  test('the paragraph goes to bonsai with its framing and its Well’s Lens', async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(paragraphOnly(), model);
    const paragraph = await drawnParagraph(interview, v.file(TODAY));
    const offer = await interview.revisitOffer(paragraph);

    expect(seen.revisit).toHaveLength(1);
    expect(seen.revisit[0]?.paragraph).toBe(PARAGRAPH);
    expect(seen.revisit[0]?.framing).toBe('in their note on Blender');
    expect(seen.revisit[0]?.lens).toBe('Ask for a time it went wrong.');
    expect(offer).toEqual({ candidates: [], lens: 'craft' });
  });

  test('a Sitting block carries the question it answered into the Asked set', async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(sittingBlock(), model);
    await interview.revisitOffer(await drawnParagraph(interview, v.file(TODAY)));

    expect(seen.revisit[0]?.paragraph).toBe(ANSWERED);
    expect(seen.revisit[0]?.framing).toBe('in a Sitting on 2026-09-14');
    // Without this the draw could hand back the question that made the block.
    expect(seen.revisit[0]?.asked).toEqual(['what broke in the rig?']);
    // The self has no Lens; the Bank is never steered.
    expect(seen.revisit[0]?.lens).toBe('');
  });

  test('a paragraph from a Piece has no Asked set, and says so by being empty', async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(
      {
        [TODAY]: EMPTY_SITTING,
        'Pieces/cities.md': `---\ntitle: Cities\nstatus: published\ndate: 2021-03-04\n---\n\n${PARAGRAPH} ^p-004\n`,
      },
      model,
    );
    await interview.revisitOffer(await drawnParagraph(interview, v.file(TODAY)));
    expect(seen.revisit[0]?.framing).toBe('in 2021, in "Cities"');
    expect(seen.revisit[0]?.asked).toEqual([]);
  });

  test('with the model off the offer is empty, so the caller shows the one fixed fallback', async () => {
    const { v, interview } = open(paragraphOnly());
    const offer = await interview.revisitOffer(await drawnParagraph(interview, v.file(TODAY)));
    expect(offer).toEqual({ candidates: [], lens: 'craft' });
  });

  test('accepting a Revisit embeds the paragraph and gives it a block id', async () => {
    const { model } = recordingModel({ revisit: [{ question: 'which corner broke it first?' }] });
    const { v, interview } = open(paragraphOnly(), model);
    const sitting = v.file(TODAY);
    const paragraph = await drawnParagraph(interview, sitting);
    await interview.acceptRevisit(sitting, paragraph, { question: 'which corner broke it first?' });

    const written = v.text(TODAY);
    const id = /\^([a-z0-9]{6})/.exec(v.text('Domains/Blender.md'))?.[1];
    expect(id).toBeDefined();
    expect(written).toContain('> [!ask] which corner broke it first?');
    expect(written).toContain(`> from [[Domains/Blender#^${id}]]`);
    expect(written).toContain(`> ![[Domains/Blender#^${id}]]`);
  });

  test('a due marker on the candidate becomes a due line on the Ask', async () => {
    const { v, interview } = open(paragraphOnly());
    const sitting = v.file(TODAY);
    const paragraph = await drawnParagraph(interview, sitting);
    await interview.acceptRevisit(sitting, paragraph, { question: 'can you rig one by Friday?', dueDays: 7 });
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
    await interview.revisitOffer(picked as Paragraph);
    expect(seen.revisit[0]?.paragraph).toBe('the hips always break');
    expect(seen.revisit[0]?.framing).toBe('in 2021, in "Cities"');
  });

  test("the jar's word floor does not apply: what the owner points at, they meant", async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(reading(), model);
    const picked = interview.selection({ file: v.file('Pieces/cities.md'), selected: 'the hips', line: 6 });
    await interview.revisitOffer(picked as Paragraph);
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
    await interview.acceptRevisit(sitting, picked as Paragraph, { question: 'which corner broke it first?' });

    expect(v.text('Sittings/2026-09-13.md')).toContain('> [!ask] which corner broke it first?');
    expect(surface.notices).toContain('Asked in 2026-09-13.');
  });
});
