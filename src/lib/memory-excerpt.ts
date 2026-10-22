/** Bound search work without discarding the end of a user's question. */
export function spreadMemoryTerms(terms: string[], limit: number): string[] {
  const unique = [...new Set(terms.filter(Boolean))];
  if (unique.length <= limit) return unique;
  const edge = Math.max(1, Math.floor(limit / 3));
  const selected = new Set([...unique.slice(0, edge), ...unique.slice(-edge)]);
  const middle = unique.slice(edge, -edge);
  const slots = limit - selected.size;
  for (let i = 0; i < slots; i++) selected.add(middle[Math.floor((i + 0.5) * middle.length / slots)]);
  return [...selected];
}

/** A single, contiguous original passage, with visible omissions. Never joins invented sentences. */
export function memoryExcerpt(text: string, terms: string[], limit: number): string {
  const source = text.trim();
  if (source.length <= limit) return source;
  // Match against a normalised copy but keep original offsets, case and punctuation.
  const normalised: string[] = [];
  const offsets: number[] = [];
  for (let at = 0; at < source.length;) {
    const char = String.fromCodePoint(source.codePointAt(at)!);
    const value = char.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u3000，。！？、,.!?;；:："“”‘’（）()【】[\]{}]/gu, '');
    for (let i = 0; i < value.length; i++) { normalised.push(value[i]); offsets.push(at); }
    at += char.length;
  }
  const searchable = normalised.join('');
  const anchors = new Set([0]);
  const hits: { start: number; end: number; term: string }[] = [];
  for (const term of new Set(terms)) {
    const query = term.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u3000，。！？、,.!?;；:："“”‘’（）()【】[\]{}]/gu, '');
    if (!query) continue;
    let from = 0;
    for (let count = 0; count < 64; count++) {
      const found = searchable.indexOf(query, from);
      if (found < 0) break;
      const start = offsets[found], end = offsets[found + query.length - 1] + 1;
      hits.push({ start, end, term });
      anchors.add(Math.max(0, Math.min(source.length - limit, start - Math.floor(limit / 3))));
      from = found + Math.max(1, query.length);
    }
  }
  let bestAt = 0, bestScore = 0;
  for (const at of anchors) {
    const score = new Set(hits.filter(hit => hit.start >= at && hit.end <= at + limit).map(hit => hit.term)).size;
    if (score > bestScore) { bestScore = score; bestAt = at; }
  }
  // Do not start in the middle of a sentence when a nearby boundary preserves the hits.
  if (bestAt > 0 && bestAt + limit < source.length) {
    const before = source.slice(Math.max(0, bestAt - 100), bestAt);
    const boundary = Math.max(before.lastIndexOf('。'), before.lastIndexOf('\n'), before.lastIndexOf('；'), before.lastIndexOf('！'), before.lastIndexOf('？'));
    if (boundary >= 0) {
      const at = Math.max(0, bestAt - 100) + boundary + 1;
      if (new Set(hits.filter(hit => hit.start >= at && hit.end <= at + limit).map(hit => hit.term)).size >= bestScore) bestAt = at;
    }
  }
  // Keep UTF-16 surrogate pairs intact at either edge.
  if (bestAt && /[\uDC00-\uDFFF]/u.test(source[bestAt])) bestAt--;
  let end = Math.min(source.length, bestAt + limit);
  if (end < source.length && /[\uDC00-\uDFFF]/u.test(source[end])) end--;
  return `${bestAt ? '…' : ''}${source.slice(bestAt, end)}${end < source.length ? '…' : ''}`;
}
