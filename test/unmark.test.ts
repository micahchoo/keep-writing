import { expect, test } from 'bun:test';
import { unmarkAt } from '../src/unmark';
import { fakeVault } from './fake-vault';
const answer = '> [!ask] What happened?\n> from [[Pieces/a#^p]]\n\nThe answer I wrote. ^a1';
test('unmark removes only its relation, retains IDs, and conditionally clears bookmarks', async () => {
  const v = fakeVault({
    'Sittings/day.md': '---\nanswers:\n  - "[[Pieces/a#^p]]"\n  - "[[Pieces/b#^p]]"\n---\n' + answer,
    'Pieces/a.md': '---\nanswered-by:\n  - "[[Sittings/day#^a1]]"\n  - "[[Sittings/other#^a2]]"\n---\nSource text. ^p',
    'Pieces/b.md': 'Source two. ^p',
    'me.md': '---\nnext: "[[Sittings/day#^a1]]"\n---',
    'other.md': '---\nnext: "[[Sittings/other#^a2]]"\n---',
  });
  v.app.vault.read = v.app.vault.cachedRead;
  const line = v.text('Sittings/day.md').split('\n').findIndex(line => line.includes('The answer'));
  expect(await unmarkAt(v.app, v.file('Sittings/day.md'), line)).toContain('unmarked');
  expect(v.text('Sittings/day.md')).toContain('^a1');
  expect(v.frontmatter('Sittings/day.md').answers).toEqual(['[[Pieces/b#^p]]']);
  expect(v.frontmatter('Pieces/a.md')['answered-by']).toEqual(['[[Sittings/other#^a2]]']);
  expect(v.frontmatter('me.md').next).toBeUndefined();
  expect(v.frontmatter('other.md').next).toBe('[[Sittings/other#^a2]]');
});
test('ambiguous shared answer properties refuse without writing', async () => {
  const v = fakeVault({ 'Sittings/day.md': answer + '\n\n' + answer, 'Pieces/a.md': 'Source text. ^p' });
  v.app.vault.read = v.app.vault.cachedRead;
  expect(await unmarkAt(v.app, v.file('Sittings/day.md'), 3)).toContain('shared');
  expect(v.writes).toEqual([]);
});
