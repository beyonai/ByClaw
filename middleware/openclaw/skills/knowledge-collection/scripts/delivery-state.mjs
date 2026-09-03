function inventoryItems(session) {
  return Array.isArray(session?.collection?.collection?.items)
    ? session.collection.collection.items : [];
}

export function summarizePromotedDelivery(session) {
  const requestedItemCount = Number(session?.task?.requestedItemCount)
    || Number(session?.task?.publicCollectRun?.requestedCount) || 0;
  const registeredIds = new Set(session?.task?.publicCollectRun?.deliverableItemIds || []);
  const requireRegistration = Boolean(session?.task?.publicCollectRun);
  const seenGroups = new Set();
  const deliverableItemIds = [];
  for (const item of inventoryItems(session)) {
    const group = item?.duplicateGroup || item?.contentFingerprint;
    const eligible = typeof item?.promotionId === 'string' && item.promotionId
      && typeof item?.verificationReceipt === 'string' && item.verificationReceipt
      && item?.fullTextEvidence?.schemaVersion === '1.0'
      && item?.materialization?.status === 'materialized'
      && item?.materialization?.contentGranularity === 'full-text'
      && ['matched', 'not-required'].includes(item?.verifiedTopicStatus)
      && typeof group === 'string' && group
      && (!requireRegistration || registeredIds.has(item.itemId));
    if (!eligible || seenGroups.has(group)) continue;
    seenGroups.add(group);
    deliverableItemIds.push(item.itemId);
  }
  return {
    requestedItemCount,
    deliverableArticleCount: deliverableItemIds.length,
    remainingCount: Math.max(0, requestedItemCount - deliverableItemIds.length),
    deliverableItemIds,
  };
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
  const requiredContentGranularity = session?.task?.requiredContentGranularity || 'any';
  if (target === 'candidates') return requiredContentGranularity === 'any';
  const items = inventoryItems(session);
  if (items.length === 0) return false;
  if (items.some((item) => item?.materialization?.status !== 'materialized')) return false;
  if (requiredContentGranularity === 'full-text'
    && items.some((item) => item?.materialization?.contentGranularity !== 'full-text')) return false;
  const requestedCount = Number(session?.task?.requestedItemCount)
    || Number(session?.task?.publicCollectRun?.requestedCount) || 0;
  if (requestedCount > 0
    && summarizePromotedDelivery(session).deliverableArticleCount < requestedCount) return false;
  const crawl = summarizeCrawlDelivery(session);
  if (!crawl) return true;
  if (crawl.pending > 0 || crawl.failed > 0 || crawl.fetchedUnmaterialized > 0) return false;
  return target !== 'all' || crawl.coverage.overCap === 0;
}
