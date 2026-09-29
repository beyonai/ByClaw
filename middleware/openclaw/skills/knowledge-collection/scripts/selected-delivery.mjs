const ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function parseIds(rawIds) {
  const ids = Array.isArray(rawIds) ? rawIds : typeof rawIds === 'string' ? rawIds.split(',') : [];
  if (!ids.length || ids.some((id) => typeof id !== 'string'
    || !id.trim() || !ITEM_ID.test(id.trim()))) {
    throw new Error('--item-ids must contain non-empty, well-formed item IDs');
  }
  const trimmed = ids.map((id) => id.trim());
  if (new Set(trimmed).size !== trimmed.length) throw new Error('--item-ids contains duplicate IDs');
  return trimmed;
}

export function selectedItemSource(item) {
  if (item?.sourceSkill === 'project-cloud-knowledge') {
    return !item.source || item.source === 'cloud-knowledge' ? 'cloud-knowledge' : null;
  }
  if (item?.source === 'cloud-knowledge' && item.sourceSkill) return null;
  return item?.source;
}

export function selectedInventoryItems(inventory, selection, sourceScope = null) {
  if (selection?.schemaVersion !== '1.0' || !Array.isArray(selection.itemIds)
    || !selection.itemIds.length || !Array.isArray(inventory)) return null;
  let ids;
  try { ids = parseIds(selection.itemIds); } catch { return null; }
  const byId = new Map(inventory.map((item) => [item?.itemId, item]));
  if (byId.size !== inventory.length || ids.some((id) => !byId.has(id))) return null;
  if (sourceScope && ids.some((id) => !sourceScope.includes(selectedItemSource(byId.get(id))))) return null;
  return ids.map((id) => byId.get(id));
}

export function selectionAppliesToSession(session) {
  const metadata = session?.collection?.sourceMetadata;
  return session?.task?.materializationTarget === 'selected'
    && session?.task?.selectedDelivery !== undefined
    && (metadata?.operation === 'unified-search' || metadata?.selectionWorkflow === 'unified'
      || metadata?.source === 'cloud-knowledge');
}

export function validateSelectedRequest(rawIds, inventory, sourceScope, previous = null) {
  const ids = parseIds(rawIds);
  const allowed = new Set(sourceScope);
  const byId = new Map(inventory.map((item) => [item?.itemId, item]));
  if (byId.size !== inventory.length || ids.some((id) => !byId.has(id))) {
    throw new Error('one or more --item-ids are not candidates in this session');
  }
  if (ids.some((id) => !allowed.has(selectedItemSource(byId.get(id))))) {
    throw new Error('one or more --item-ids are outside authorized sourceScope');
  }
  if (previous !== null && selectedInventoryItems(inventory, previous, sourceScope) === null) {
    throw new Error('stored selected delivery is invalid');
  }
  const cumulative = [...new Set([...(previous?.itemIds || []), ...ids])];
  return { schemaVersion: '1.0', itemIds: cumulative };
}
