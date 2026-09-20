import { describe, expect, test } from 'bun:test';
import { Interview } from '../src/interview';
import { AnsweredIndex } from '../src/bank';
import { DEFAULT_SETTINGS } from '../src/settings';
import { createModel } from '../src/model';
import { fakeVault } from './fake-vault';

const original = 'The originally selected paragraph.';
function fixture(id = '') {
  const v = fakeVault({ 'Notes/source.md': `${original}${id}\n`, 'Sittings/today.md': '## Asked\n' });
  const file = v.file('Notes/source.md');
  const notices: string[] = [];
  const interview = new Interview({ app: v.app, settings: DEFAULT_SETTINGS, index: new AnsweredIndex(v.app), model: createModel({ ...DEFAULT_SETTINGS, enableModel: false }) }, { notice: s => notices.push(s), placeCursor: () => true });
  const source = interview.selection({ file, selected: original, line: 0, document: v.text(file.path) })!;
  const accept = () => interview.acceptFrom(v.file('Sittings/today.md'), source, { question: 'What changed?' }, 'pointed');
  return { v, file, source, notices, accept };
}

describe('delayed selection acceptance', () => {
  test('relocates a unique unchanged paragraph after preceding insertion', async () => {
    const { v, file, accept } = fixture();
    await v.app.vault.process(file, () => `Unrelated paragraph.\n\n${original}\n`);
    await accept();
    expect(v.text(file.path)).toMatch(/^Unrelated paragraph\.\n\nThe originally selected paragraph\. \^[a-z0-9]{6}\n$/);
    expect(v.text('Sittings/today.md')).toContain('> from [[Notes/source#^');
  });

  for (const change of ['edit', 'delete', 'duplicates', 'stale metadata', 'existing ID edited', 'existing ID deleted']) {
    test(`refuses ${change} without writing`, async () => {
      const { v, file, notices, accept } = fixture(change.startsWith('existing') ? ' ^original' : '');
      const cache = v.app.metadataCache.getFileCache(file);
      const body = change === 'duplicates' ? `${original}\n\n${original}\n`
        : change === 'stale metadata' ? `Unrelated paragraph.\n\n${original}\n`
        : change.includes('delete') ? '' : 'Edited paragraph. ^original\n';
      await v.app.vault.process(file, () => body);
      if (change === 'stale metadata') v.app.metadataCache.getFileCache = () => cache;
      v.writes.length = 0;
      await accept();
      expect(v.writes).toHaveLength(0);
      expect(v.text(file.path)).toBe(body);
      expect(notices).toHaveLength(1);
    });
  }

  test('reuses the original ID after a unique move without changing prose', async () => {
    const { v, file, accept } = fixture(' ^original');
    const body = `Unrelated paragraph.\n\n${original} ^original\n`;
    await v.app.vault.process(file, () => body);
    await accept();
    expect(v.text(file.path)).toBe(body);
    expect(v.text('Sittings/today.md')).toContain('[[Notes/source#^original]]');
  });

  test('checks current text again inside the atomic write', async () => {
    const { v, file, notices, accept } = fixture();
    const process = v.app.vault.process.bind(v.app.vault);
    let raced = false;
    v.app.vault.process = async (f, update) => {
      if (!raced) { raced = true; await process(file, () => 'Concurrent replacement.\n'); }
      return process(f, update);
    };
    await accept();
    expect(v.text(file.path)).toBe('Concurrent replacement.\n');
    expect(v.text('Sittings/today.md')).toBe('## Asked\n');
    expect(notices).toHaveLength(1);
  });
});
