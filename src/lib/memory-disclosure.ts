/**
 * Deterministic backstop for public text generated with private actor context.
 * It catches verbatim or near-verbatim reuse; semantic paraphrases still go
 * through the model disclosure reviewer and fail closed when review is unclear.
 */
function normalizeForDisclosure(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

export function containsPrivateMemoryEcho(publicText: string, privateContext: string): boolean {
  const candidate = normalizeForDisclosure(publicText);
  if (!candidate) return false;
  const fragments = privateContext
    .split(/[\r\n。！？；;]+/u)
    .map((line) => line.replace(/^\s*[-•]?\s*\[[^\]]+\]\s*/u, '').trim())
    .filter((line) => line.length >= 4 && !/^【|^以下是资料|^只在当前话题/u.test(line));
  for (const fragment of fragments) {
    const normalized = normalizeForDisclosure(fragment);
    if (normalized.length < 4) continue;
    if (candidate.includes(normalized)) return true;
    const windowSize = Math.min(8, normalized.length);
    for (let index = 0; index + windowSize <= normalized.length; index += 1) {
      if (candidate.includes(normalized.slice(index, index + windowSize))) return true;
    }
  }
  return false;
}
