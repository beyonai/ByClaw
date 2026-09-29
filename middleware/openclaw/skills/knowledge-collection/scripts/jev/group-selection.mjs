import { prioritizeItems } from './selection.mjs';

const MAX_GROUPS = 500;
const compactTitle = (title) => title.length <= 80 ? title : `${title.slice(0, 39)}…${title.slice(-40)}`;

// Rank already authorized groups; never filter candidates or alter order within a group.
export async function prioritizeGroups(request, items, groupOf, options = {}) {
  const fallback = (code, status = 'skipped') => ({ items, diagnostic: { status, code } });
  if (!Array.isArray(items) || items.length < 2) return fallback('NO_SELECTION_CHOICES');
  try {
    const groups = new Map();
    for (const item of items) {
      const group = groupOf(item);
      if (typeof group?.key !== 'string' || !group.key || typeof group.title !== 'string' || !group.title) {
        return fallback('INVALID_GROUP');
      }
      if (!groups.has(group.key)) groups.set(group.key, { title: group.title, entries: [] });
      groups.get(group.key).entries.push(item);
      if (groups.size > MAX_GROUPS) return fallback('SELECTION_GROUP_LIMIT');
    }
    if (groups.size < 2) return fallback('NO_SELECTION_CHOICES');
    const rows = [...groups.values()];
    if (rows.length <= 96) {
      const ranked = await prioritizeItems(request, rows, options);
      if (ranked.diagnostic.status !== 'used') return { items, diagnostic: ranked.diagnostic };
      return { items: ranked.items.flatMap((group) => group.entries), diagnostic: ranked.diagnostic };
    }
    const now = options.now || (() => performance.now());
    const deadline = now() + Math.min(2000, options.budgetMs ?? 2000);
    const boundedOptions = { ...options, remainingBudgetMs: () => Math.max(0, Math.min(deadline - now(),
      options.remainingBudgetMs ? options.remainingBudgetMs() : Infinity)) };
    const bucketCount = Math.ceil(rows.length / 24);
    const bucketSize = Math.ceil(rows.length / bucketCount);
    const buckets = [];
    for (let offset = 0; offset < rows.length; offset += bucketSize) {
      const members = rows.slice(offset, offset + bucketSize);
      buckets.push({ title: members.slice(0, 2).map((group) => compactTitle(group.title)).join(' · '),
        text: members.map((group) => compactTitle(group.title)).join('\n'), members });
    }
    const coarse = await prioritizeItems(request, buckets, boundedOptions);
    if (coarse.diagnostic.status !== 'used') return { items, diagnostic: coarse.diagnostic };
    const leading = coarse.items[0];
    const refined = await prioritizeItems(request, leading.members, boundedOptions);
    if (refined.diagnostic.status !== 'used') return { items, diagnostic: refined.diagnostic };
    return { items: [...refined.items, ...coarse.items.slice(1).flatMap((bucket) => bucket.members)]
      .flatMap((group) => group.entries), diagnostic: { ...refined.diagnostic, count: rows.length } };
  } catch {
    return fallback('GROUP_SELECTION_FAILED', 'fallback');
  }
}
