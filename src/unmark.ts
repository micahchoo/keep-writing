import type { App, TFile } from 'obsidian';
import { parseAsks } from './asks';
import { keyOfRef, parseRef, refOf } from './refs';
import type { Ref } from './refs';

/** Remove only this relation. Native IDs and authored text are never deleted. */
export async function unmarkAt(app: App, file: TFile, line: number): Promise<string> {
  const text = await app.vault.read(file);
  const asks = parseAsks(text);
  const ask = asks.find(value => value.answer.start <= line && line < value.answer.end);
  if (!ask || !ask.firstParagraph) return 'Place the cursor in an answer under an Ask.';
  const source = parseRef(ask.sourceRef);
  const sourceKey = source && keyOfRef(app, source, file.path);
  if (!source || !sourceKey) return 'The source link cannot be resolved. Nothing was changed.';
  if (asks.filter(value => { const ref = parseRef(value.sourceRef); return ref && keyOfRef(app, ref, file.path) === sourceKey; }).length > 1) return 'Several asks in this note share that source. Their answer property is shared; nothing was changed.';
  const paragraph = text.split('\n').slice(ask.firstParagraph.start, ask.firstParagraph.end + 1).join('\n');
  const id = /\^([A-Za-z0-9-]+)\s*$/.exec(paragraph)?.[1];
  if (!id) return 'This answer has no block ID. Nothing was changed.';
  const answer = refOf(file, id);
  const answerKey = keyOfRef(app, answer, file.path);
  const matches = (value: unknown, ref: Ref, from: string): boolean => {
    if (typeof value !== 'string') return false;
    const parsed = parseRef(value);
    return !!parsed && keyOfRef(app, parsed, from) === keyOfRef(app, ref, file.path);
  };
  const remove = async (target: TFile, property: string, ref: Ref) => {
    await app.fileManager.processFrontMatter(target, (fm: Record<string, unknown>) => {
      const value = fm[property];
      if (Array.isArray(value)) {
        const remaining = value.filter(item => !matches(item, ref, target.path));
        if (remaining.length !== value.length) { if (remaining.length) fm[property] = remaining; else delete fm[property]; }
      } else if (matches(value, ref, target.path)) delete fm[property];
    });
  };
  // Remove the inverse and bookmark first: a failed write leaves the answer marked for retry.
  let citations = 0;
  for (const target of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(target);
    if (cache?.links?.some(link => { const ref = parseRef(link.link); return ref && keyOfRef(app, ref, target.path) === answerKey; })) citations++;
    const contains = (value: unknown) => (Array.isArray(value) ? value : [value]).some(item => matches(item, answer, target.path));
    if (target.path === app.metadataCache.getFirstLinkpathDest(source.path, file.path)?.path && contains(cache?.frontmatter?.['answered-by'])) await remove(target, 'answered-by', answer);
    if (contains(cache?.frontmatter?.next)) await remove(target, 'next', answer);
  }
  await remove(file, 'answers', source);
  return `Answer unmarked. Block ID and register tags kept.${citations ? ` ${citations} note(s) still cite this answer; their follow-ups and links were kept.` : ''}`;
}
