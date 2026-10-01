/** Relevance score for `text` against an already-lowercased, trimmed `query` — lower is better,
 *  `null` = no match. Tiers: exact, prefix, match at a word start (after `_`/`-`/`.`/space or a
 *  camelCase hump), then plain substring (earlier position wins). */
function scoreMatch(text: string, query: string): number | null {
  const lower = text.toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;

  let best: number | null = null;
  let from = 0;
  for (let i = lower.indexOf(query, from); i !== -1; i = lower.indexOf(query, from)) {
    const prev = text[i - 1];
    const atWordStart =
      i === 0 ||
      /[\s_.\-/]/.test(prev) ||
      (/[a-z0-9]/.test(prev) && /[A-Z]/.test(text[i]));
    const score = atWordStart ? 2 : 3 + i / 1000;
    if (best === null || score < best) best = score;
    if (atWordStart) break;
    from = i + 1;
  }
  return best;
}

/** Filters `items` by case-insensitive substring match on `getText`, ordered best match first
 *  (ties: shorter text, then alphabetical). Empty query returns `items` unchanged. */
export function rankByMatch<T>(items: readonly T[], query: string, getText: (item: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  const scored: { item: T; text: string; score: number }[] = [];
  for (const item of items) {
    const text = getText(item);
    const score = scoreMatch(text, q);
    if (score !== null) scored.push({ item, text, score });
  }
  scored.sort((a, b) => a.score - b.score || a.text.length - b.text.length || a.text.localeCompare(b.text));
  return scored.map((s) => s.item);
}
