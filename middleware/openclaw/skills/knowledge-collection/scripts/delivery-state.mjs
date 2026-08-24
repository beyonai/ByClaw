function inventoryItems(session) {
  return Array.isArray(session?.collection?.collection?.items)
    ? session.collection.collection.items : [];
}

function coverage(crawl) {
  const value = crawl?.coverage && typeof crawl.coverage === 'object' ? crawl.coverage : {};
  return {
    discovered: Number(value.discovered) || 0,
    duplicate: Number(value.duplicate) || 0,
    outOfScope: Number(value.outOfScope) || 0,
    overCap: Number(value.overCap) || 0,
  };
}

export function summarizeCrawlDelivery(session) {
  const crawl = session?.crawl;
  if (!crawl || !Array.isArray(crawl.entries)) return null;
  const counts = { pending: 0, fetched: 0, failed: 0, skipped: 0 };
  for (const entry of crawl.entries) {
    if (counts[entry?.status] !== undefined) counts[entry.status] += 1;
  }
  const materialized = inventoryItems(session).filter(
    (item) => item?.materialization?.status === 'materialized',
  );
  const materializedIds = new Set(materialized.map((item) => item.itemId));
  const materializedUrls = new Set(materialized.map((item) => item.sourceUrl));
  const fetchedUnmaterialized = crawl.entries.filter((entry) => entry?.status === 'fetched'
    && !(entry.itemId && materializedIds.has(entry.itemId))
    && !materializedUrls.has(entry.url)).length;
  return {
    total: crawl.entries.length,
    ...counts,
    fetchedUnmaterialized,
    coverage: coverage(crawl),
    scopePrefix: crawl.scopePrefix ?? null,
    maxPages: crawl.maxPages ?? null,
    seededAt: crawl.seededAt ?? null,
  };
}

export function deliveryCompleteForSession(session) {
  const collection = session?.collection?.collection;
  if (!collection || collection.status === 'failed' || collection.status === 'partial') return false;
  const target = session?.task?.materializationTarget || 'selected';
  if (target === 'candidates') return true;
  const items = inventoryItems(session);
  if (items.some((item) => item?.materialization?.status !== 'materialized')) return false;
  const crawl = summarizeCrawlDelivery(session);
  if (!crawl) return true;
  if (crawl.pending > 0 || crawl.failed > 0 || crawl.fetchedUnmaterialized > 0) return false;
  return target !== 'all' || crawl.coverage.overCap === 0;
}
