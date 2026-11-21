function parseSnippets(html: string): string[] {
  const snippets: string[] = [];
  const snippetRegex = /<td class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;

  while ((match = snippetRegex.exec(html)) !== null) {
    const text = match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .trim();
    if (text && text.length > 20) {
      snippets.push(text);
    }
    if (snippets.length >= 3) break;
  }
  return snippets;
}

async function searchLite(query: string, signal?: AbortSignal): Promise<string[]> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];
    return parseSnippets(await response.text());
  } catch (cause) {
    if (signal?.aborted) throw signal.reason ?? cause;
    return [];
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function duckDuckGoSearch(query: string, signal?: AbortSignal): Promise<string> {
  try {
    // Search authoritative sources first (Baidu Baike + Wikipedia)
    const authoritativeQuery = `site:baike.baidu.com OR site:zh.wikipedia.org ${query}`;
    const [authoritative, general] = await Promise.all([
      searchLite(authoritativeQuery, signal),
      searchLite(query, signal),
    ]);

    // Merge: authoritative first, then general (deduplicated roughly)
    const seen = new Set<string>();
    const all: string[] = [];
    for (const s of [...authoritative, ...general]) {
      // Simple dedup by first 30 chars
      const key = s.slice(0, 30);
      if (!seen.has(key)) {
        seen.add(key);
        all.push(s);
      }
      if (all.length >= 5) break;
    }

    return all.join('\n\n').slice(0, 2000);
  } catch (cause) {
    if (signal?.aborted) throw signal.reason ?? cause;
    return ''; // Graceful degradation — proceed without web context
  }
}
