// The Interview, driven through its own interface: one Sitting's worth.
//
// Every fixture here holds exactly ONE drawable source, so the draw is
// deterministic without the Interview having to take a random seam it would
// never use in the vault.

import { describe, expect, test } from 'bun:test';
import { parseAsks } from '../src/asks';
import type { Ask } from '../src/asks';
import { AnsweredIndex } from '../src/bank';
import type { Candidate, Model, Proposal, RevisitCandidate } from '../src/model';
import { Interview } from '../src/interview';
import type { InterviewHost } from '../src/interview';
import { DEFAULT_SETTINGS } from '../src/settings';
import { fakeVault } from './fake-vault';
import type { VaultHooks } from './fake-vault';

// ---------------------------------------------------------------------------
// The two adapters the Interview needs

interface Plan {
  revisit?: RevisitCandidate[];
  followUps?: string[];
  proposal?: Proposal | null;
  /** When set, composeRevisit waits for it before answering. */
  hold?: Promise<void>;
}

function recordingModel(plan: Plan = {}) {
  const seen = {
    revisit: [] as { paragraph: string; framing: string; asked: string[]; lens: string }[],
    followUp: [] as { question: string; answer: string; asked: string[]; target: string }[],
    proposal: [] as Candidate[][],
  };
  const model: Model = {
    available: true,
    reason: '',
    composeRevisit: async (paragraph, framing, asked, lens) => {
      seen.revisit.push({ paragraph, framing, asked, lens });
      if (plan.hold) await plan.hold;
      return plan.revisit ?? [];
    },
    composeFollowUps: async (question, answer, asked, target) => {
      seen.followUp.push({ question, answer, asked, target });
      return plan.followUps ?? [];
    },
    proposeRelation: async (_answer, candidates) => {
      seen.proposal.push(candidates);
      return plan.proposal ?? null;
    },
  };
  return { model, seen };
}

const OFF: Model = {
  available: false,
  reason: 'model switched off in settings',
  composeRevisit: async () => [],
  composeFollowUps: async () => [],
  proposeRelation: async () => null,
};

function open(notes: Record<string, string>, model: Model = OFF, hooks: VaultHooks = {}) {
  const v = fakeVault(notes, hooks);
  const surface = { renders: 0, cursors: [] as { path: string; line: number }[], notices: [] as string[] };
  const host: InterviewHost = {
    app: v.app,
    settings: { ...DEFAULT_SETTINGS },
    index: new AnsweredIndex(v.app),
    model,
  };
  const interview = new Interview(host, {
    changed: () => {
      surface.renders++;
    },
    placeCursor: (file, line) => surface.cursors.push({ path: file.path, line }),
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

// ---------------------------------------------------------------------------

describe('following the owner', () => {
  test('a note that is not a Sitting draws nothing', async () => {
    const { v, interview } = open(bankOnly());
    expect(await interview.track(v.file('Bank/craft.md'))).toBe(true);
    expect(interview.state.inSitting).toBe(false);
    expect(interview.state.drawn).toBeNull();
    expect(interview.state.asks).toEqual([]);
  });

  test('a Sitting draws at once, and reports what the jars held', async () => {
    const { v, interview } = open(bankOnly());
    await interview.track(v.file(TODAY));
    expect(interview.state.inSitting).toBe(true);
    expect(interview.state.drawn?.source.kind).toBe('question');
    expect(interview.state.jars).toEqual({ questions: 1, paragraphs: 0, wells: 0 });
  });

  test('the same file again is not a change, so the pane is left alone', async () => {
    const { v, interview, surface } = open(bankOnly());
    await interview.track(v.file(TODAY));
    const renders = surface.renders;
    expect(await interview.track(v.file(TODAY))).toBe(false);
    expect(surface.renders).toBe(renders);
  });

  // The gate in front of every render. `metadataCache.changed` fires while the
  // owner types an answer; a save that added a word moved no Ask, and a render
  // there lands between a mousedown and a mouseup and swallows the click.
  test('a metadata change that moved no Ask leaves the pane alone', async () => {
    const { v, interview, surface } = open(bankOnly());
    await interview.track(v.file(TODAY));
    const renders = surface.renders;
    await interview.reloadAsks();
    await interview.reloadAsks();
    expect(surface.renders).toBe(renders);
  });

  test('an Ask that arrived IS a change, so the pane draws once', async () => {
    const { v, interview, surface } = open(bankOnly());
    await interview.track(v.file(TODAY));
    const renders = surface.renders;
    await v.app.vault.process(
      v.file(TODAY),
      (d) => `${d}\n> [!ask] what did you make?\n> from [[Bank/craft#^b1]]\n\nan answer\n`,
    );
    await interview.reloadAsks();
    await interview.reloadAsks();
    expect(surface.renders).toBe(renders + 1);
    expect(interview.state.asks).toHaveLength(1);
  });

  test('no active editor keeps the note we were on: a click on the pane is not a move', async () => {
    const { v, interview } = open(bankOnly());
    await interview.track(v.file(TODAY));
    expect(await interview.track(null)).toBe(false);
    expect(interview.state.file?.path).toBe(TODAY);
  });

  test('a Target is read off the Sitting', async () => {
    const notes = paragraphOnly();
    notes[TODAY] = '---\nabout: "[[Blender]]"\n---\n\n## Asked\n\n';
    const { v, interview } = open(notes);
    await interview.track(v.file(TODAY));
    expect(interview.state.target?.name).toBe('Blender');
    expect(interview.state.target?.kind).toBe('domain');
  });
});

describe('the draw', () => {
  test('accepting writes the Ask, cites its source, and puts the cursor under it', async () => {
    const { v, interview, surface } = open(bankOnly());
    await interview.track(v.file(TODAY));
    await interview.accept();

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
    await interview.track(v.file(TODAY));
    await interview.accept();
    // accept() redraws; the bank held one question and it is now placed.
    expect(interview.state.drawn).toBeNull();
  });

  test('a skipped source does not come back', async () => {
    const { v, interview } = open(bankOnly());
    await interview.track(v.file(TODAY));
    interview.skip();
    await interview.redraw();
    expect(interview.state.drawn).toBeNull();
  });

  test('an answered question is out of the jar', async () => {
    const notes = bankOnly();
    notes[TODAY] = '---\nanswers:\n  - "[[Bank/craft#^b1]]"\n---\n\n## Asked\n\n';
    const { v, interview } = open(notes);
    await interview.track(v.file(TODAY));
    expect(interview.state.drawn).toBeNull();
    expect(interview.state.jars.questions).toBe(0);
  });
});

describe('two draws at once', () => {
  // Bookmark, Open door and Back to bank never disable, and a command reaches
  // the Interview with no pane open at all, so nothing in the DOM keeps two
  // draws apart. Each draw reads the whole Bank, so overlapping is ordinary.
  const twoSources = () => ({
    [TODAY]: EMPTY_SITTING,
    'Bank/craft.md': '---\nkind: bank\n---\n\n- what did you make? #register/episode ^b1\n',
    'Bank/closing.md': '---\nkind: bank\n---\n\n- what did we not touch today? #register/state #role/door ^d1\n',
  });

  test('the one that lands late does not overwrite the one asked for last', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holdNextRead = false;
    const { v, interview } = open(twoSources(), OFF, {
      beforeRead: async () => {
        if (!holdNextRead) return;
        holdNextRead = false;
        await held;
      },
    });
    await interview.track(v.file(TODAY));

    holdNextRead = true;
    const stale = interview.redraw('target');
    const fresh = interview.redraw('door');
    await fresh;
    expect(interview.state.drawn?.source.text).toBe('what did we not touch today?');

    release?.();
    await stale;
    expect(interview.state.drawn?.source.text).toBe('what did we not touch today?');
    expect(interview.state.source).toBe('door');
    expect(interview.state.loading).toBe(false);
  });
});

describe('the Revisit', () => {
  test('the paragraph goes to bonsai with its framing and its Well’s Lens', async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(paragraphOnly(), model);
    await interview.track(v.file(TODAY));

    expect(interview.state.drawn?.source.kind).toBe('paragraph');
    expect(seen.revisit).toHaveLength(1);
    expect(seen.revisit[0]?.paragraph).toBe(PARAGRAPH);
    expect(seen.revisit[0]?.framing).toBe('in their note on Blender');
    expect(seen.revisit[0]?.lens).toBe('Ask for a time it went wrong.');
    expect(interview.state.revisit).toEqual({
      kind: 'offer',
      key: 'Domains/Blender.md#L4',
      lens: 'craft',
      candidates: [],
    });
  });

  test('a Sitting block carries the question it answered into the Asked set', async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(sittingBlock(), model);
    await interview.track(v.file(TODAY));

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
    await interview.track(v.file(TODAY));
    expect(seen.revisit[0]?.framing).toBe('in 2021, in "Cities"');
    expect(seen.revisit[0]?.asked).toEqual([]);
  });

  test('with the model off the offer is empty, so the pane shows the one fixed fallback', async () => {
    const { v, interview } = open(paragraphOnly());
    await interview.track(v.file(TODAY));
    expect(interview.state.revisit).toMatchObject({ kind: 'offer', candidates: [] });
  });

  test('accepting a Revisit embeds the paragraph and gives it a block id', async () => {
    const { model } = recordingModel({ revisit: [{ question: 'which corner broke it first?' }] });
    const { v, interview } = open(paragraphOnly(), model);
    await interview.track(v.file(TODAY));
    await interview.acceptRevisit({ question: 'which corner broke it first?' });

    const written = v.text(TODAY);
    const id = /\^([a-z0-9]{6})/.exec(v.text('Domains/Blender.md'))?.[1];
    expect(id).toBeDefined();
    expect(written).toContain('> [!ask] which corner broke it first?');
    expect(written).toContain(`> from [[Domains/Blender#^${id}]]`);
    expect(written).toContain(`> ![[Domains/Blender#^${id}]]`);
  });

  test('a due marker on the candidate becomes a due line on the Ask', async () => {
    const { model } = recordingModel();
    const { v, interview } = open(paragraphOnly(), model);
    await interview.track(v.file(TODAY));
    await interview.acceptRevisit({ question: 'can you rig one by Friday?', dueDays: 7 });
    expect(v.text(TODAY)).toMatch(/> due: \d{4}-\d{2}-\d{2}/);
  });

  test('a compose reply that lands after a redraw is dropped', async () => {
    let release = () => {};
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const { model, seen } = recordingModel({ revisit: [{ question: 'stale question?' }], hold });
    const { v, interview } = open(paragraphOnly(), model);
    const tick = () => new Promise((r) => setTimeout(r, 0));

    const drawing = interview.track(v.file(TODAY));
    while (seen.revisit.length === 0) await tick(); // bonsai now holds the only paragraph
    interview.skip();
    await tick(); // the redraw skip started finds nothing left
    expect(interview.state.drawn).toBeNull();

    release();
    await drawing;
    // The reply belongs to a paragraph nobody is looking at any more.
    expect(interview.state.revisit).toEqual({ kind: 'idle' });
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

  test('marking links the answer at birth, then asks bonsai both questions at once', async () => {
    const { model, seen } = recordingModel({
      followUps: ['which bone did you weight it to?'],
      proposal: { ref: 'Pieces/cities#^p-004', relation: 'echoes', quote: 'The pelvis bone' },
    });
    const { v, interview, surface } = open(answered(), model);
    await interview.track(v.file(TODAY));
    await interview.mark(interview.state.asks[0] as Ask);

    expect(surface.notices).toContain('Answer linked.');
    expect(v.frontmatter(TODAY)['answers']).toEqual(['[[Bank/craft#^b1]]']);

    // The Follow-up is measured against every other question this Sitting put.
    expect(seen.followUp[0]?.question).toBe('what broke in the rig?');
    expect(seen.followUp[0]?.answer).toBe(ANSWERED);
    expect(seen.followUp[0]?.asked).toEqual(['what else did you try?']);
    expect(seen.followUp[0]?.target).toBe('me');

    expect(interview.state.followUp?.questions).toEqual(['which bone did you weight it to?']);
    expect(interview.state.proposal).toMatchObject({ kind: 'offer' });
  });

  test('accepting a Follow-up writes it as an Ask citing the answer block', async () => {
    const { model } = recordingModel({ followUps: ['which bone did you weight it to?'] });
    const { v, interview } = open(answered(), model);
    await interview.track(v.file(TODAY));
    await interview.mark(interview.state.asks[0] as Ask);
    await interview.acceptFollowUp('which bone did you weight it to?');

    const id = /\^([a-z0-9]{6})/.exec(v.text(TODAY))?.[1];
    expect(v.text(TODAY)).toContain('> [!ask] which bone did you weight it to?');
    expect(v.text(TODAY)).toContain(`> from [[Sittings/2026-09-15#^${id}]]`);
    expect(interview.state.followUp).toBeNull();
  });

  test('accepting a Proposal writes the relation on both ends', async () => {
    const { model } = recordingModel({
      proposal: { ref: 'Pieces/cities#^p-004', relation: 'echoes', quote: 'The pelvis bone' },
    });
    const { v, interview, surface } = open(answered(), model);
    await interview.track(v.file(TODAY));
    await interview.mark(interview.state.asks[0] as Ask);
    await interview.acceptProposal();

    const id = /\^([a-z0-9]{6})/.exec(v.text(TODAY))?.[1];
    expect(v.frontmatter(TODAY)['echoes']).toEqual(['[[Pieces/cities#^p-004]]']);
    expect(v.frontmatter('Pieces/cities.md')['echoes']).toEqual([`[[Sittings/2026-09-15#^${id}]]`]);
    expect(surface.notices).toContain('Linked: echoes.');
    expect(interview.state.proposal).toEqual({ kind: 'idle' });
  });

  test('an abstained Proposal is a reason, and nothing is written', async () => {
    const { model } = recordingModel({ followUps: [] });
    const { v, interview } = open(answered(), model);
    await interview.track(v.file(TODAY));
    await interview.mark(interview.state.asks[0] as Ask);
    expect(interview.state.proposal).toEqual({
      kind: 'none',
      reason: 'the model found no relation, or its quote did not check out',
    });
    expect(interview.state.followUp).toBeNull();
    expect(v.frontmatter('Pieces/cities.md')['echoes']).toBeUndefined();
  });

  test('with the model off, marking still links the answer and asks nothing', async () => {
    const { v, interview } = open(answered());
    await interview.track(v.file(TODAY));
    await interview.mark(interview.state.asks[0] as Ask);
    expect(v.frontmatter(TODAY)['answers']).toEqual(['[[Bank/craft#^b1]]']);
    expect(interview.state.proposal).toEqual({ kind: 'idle' });
    expect(interview.state.followUp).toBeNull();
  });

  test('an Ask with no answer under it refuses, and writes nothing', async () => {
    const { v, interview } = open(answered());
    await interview.track(v.file(TODAY));
    const before = v.text(TODAY);
    await interview.mark(interview.state.asks[1] as Ask);
    expect(v.text(TODAY)).toBe(before);
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
    await interview.track(v.file(TODAY));
    await interview.mark(interview.state.asks[0] as Ask);
    expect(v.frontmatter('Domains/Blender.md')['next']).toMatch(/^\[\[Sittings\/2026-09-15#\^/);
  });

  // The editor command's half: the note and the line, read where the editor
  // still holds them. This lived in main.ts until 2026-09-16 and no test could
  // reach any of it. The pane need not be tracking the note.
  describe('marking the answer under the cursor', () => {
    test('the line inside an answer marks that Ask', async () => {
      const { v, interview, surface } = open(answered());
      await interview.markAt({ file: v.file(TODAY), line: 8 });
      expect(surface.notices).toContain('Answer linked.');
      expect(v.frontmatter(TODAY)['answers']).toEqual(['[[Bank/craft#^b1]]']);
    });

    test('a note that is not a Sitting refuses, and writes nothing', async () => {
      const { v, interview, surface } = open(answered());
      await interview.markAt({ file: v.file('Pieces/cities.md'), line: 5 });
      expect(surface.notices).toEqual(['The active note is not a Sitting.']);
      expect(v.writes).toHaveLength(0);
    });

    test('a line under no Ask refuses, and writes nothing', async () => {
      const { v, interview, surface } = open(answered());
      await interview.markAt({ file: v.file(TODAY), line: 3 });
      expect(surface.notices).toEqual(['The cursor is not under an Ask.']);
      expect(v.writes).toHaveLength(0);
    });

    test('an answer already linked refuses the second time', async () => {
      const { v, interview, surface } = open(answered());
      await interview.markAt({ file: v.file(TODAY), line: 8 });
      // The frontmatter write moved every body line down; find the answer again.
      const moved = (parseAsks(v.text(TODAY))[0] as Ask).firstParagraph?.start as number;
      await interview.markAt({ file: v.file(TODAY), line: moved });
      expect(surface.notices).toEqual(['Answer linked.', 'This answer is already linked.']);
    });

    // markAnswered hands back the reason; this is the Surface saying it.
    test('an Ask with nothing written under it refuses in the owner’s words', async () => {
      const { v, interview, surface } = open(answered());
      await interview.markAt({ file: v.file(TODAY), line: 12 });
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

  test('words with no prose in them are refused, and the card is untouched', async () => {
    const { model } = recordingModel();
    const { v, interview } = open(reading(), model);
    await interview.track(v.file(TODAY));
    const drawn = interview.state.drawn;

    await interview.askAbout({ file: v.file('Pieces/cities.md'), selected: '![a map](map.png)', line: 6 });
    expect(interview.state.fromSelection).toBe(false);
    expect(interview.state.drawn).toBe(drawn);
  });

  test('a selection becomes the source, framed by the note it sits in', async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(reading(), model);
    await interview.track(v.file(TODAY));
    seen.revisit.length = 0;

    await interview.askAbout({ file: v.file('Pieces/cities.md'), selected: 'the hips always break', line: 6 });
    expect(interview.state.fromSelection).toBe(true);
    expect(seen.revisit[0]?.paragraph).toBe('the hips always break');
    expect(seen.revisit[0]?.framing).toBe('in 2021, in "Cities"');
  });

  test("the jar's word floor does not apply: what the owner points at, they meant", async () => {
    const { model, seen } = recordingModel();
    const { v, interview } = open(reading(), model);
    await interview.track(v.file(TODAY));
    seen.revisit.length = 0;
    await interview.askAbout({ file: v.file('Pieces/cities.md'), selected: 'the hips', line: 6 });
    expect(seen.revisit[0]?.paragraph).toBe('the hips');
  });

  test('dismissing a selection clears the card without drawing another', async () => {
    const { model } = recordingModel();
    const { v, interview } = open(reading(), model);
    await interview.track(v.file(TODAY));
    await interview.askAbout({ file: v.file('Pieces/cities.md'), selected: 'the hips always break', line: 6 });
    interview.dismissSelection();
    expect(interview.state.drawn).toBeNull();
    expect(interview.state.fromSelection).toBe(false);
    expect(interview.state.revisit).toEqual({ kind: 'idle' });
  });

  test('a selection read outside a Sitting lands its Ask in today’s Sitting', async () => {
    const { model } = recordingModel();
    const { v, interview, surface } = open(
      { 'Sittings/2026-09-13.md': EMPTY_SITTING, 'Pieces/cities.md': reading()['Pieces/cities.md'] as string },
      model,
    );
    // The owner is reading the Piece, not sitting.
    await interview.track(v.file('Pieces/cities.md'));
    await interview.askAbout({ file: v.file('Pieces/cities.md'), selected: 'the hips always break', line: 6 });
    await interview.acceptRevisit({ question: 'which corner broke it first?' });

    // `moment()` is fixed at 2026-09-13 in the test harness.
    expect(v.text('Sittings/2026-09-13.md')).toContain('> [!ask] which corner broke it first?');
    expect(surface.notices).toContain('Asked in 2026-09-13.');
    expect(interview.state.drawn).toBeNull();
  });
});
