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

async function searchLite(query: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];
    return parseSnippets(await response.text());
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function duckDuckGoSearch(query: string): Promise<string> {
  try {
    // Search authoritative sources first (Baidu Baike + Wikipedia)
    const authoritativeQuery = `site:baike.baidu.com OR site:zh.wikipedia.org ${query}`;
    const [authoritative, general] = await Promise.all([
      searchLite(authoritativeQuery),
      searchLite(query),
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
  } catch {
    return ''; // Graceful degradation — proceed without web context
  }
}
