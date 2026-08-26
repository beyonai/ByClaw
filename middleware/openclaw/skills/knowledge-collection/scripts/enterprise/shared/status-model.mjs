export const SOURCE_IDENTITY = {
  dingtalk: { connector: 'dws', source: 'dws', backend: 'dws', sourceSkill: 'dws' },
  feishu: { connector: 'fws', source: 'fws', backend: 'lark-cli', sourceSkill: 'fws' },
  wecom: { connector: 'wecom', source: 'wecom', backend: 'wecom-cli', sourceSkill: 'wecomcli' },
  ima: { connector: 'ima', source: 'ima', backend: 'ima', sourceSkill: 'ima-skill' },
};

export const CONTENT_GRANULARITIES = new Set(['full-text', 'excerpt', 'abstract', 'unknown']);
export const COVER_STATUSES = new Set(['not-present', 'materialized', 'unavailable', 'unknown']);

export function normalizeContentGranularity(value, { strict = false } = {}) {
  if (value === undefined) return 'unknown';
  if (CONTENT_GRANULARITIES.has(value)) return value;
  if (strict) throw new TypeError('materialization.contentGranularity is invalid');
  return 'unknown';
}

export function normalizeMediaState(value, { strict = false, coverUrls = [] } = {}) {
  const knownCoverCount = [...new Set((Array.isArray(coverUrls) ? coverUrls : [])
    .filter((url) => typeof url === 'string' && url.trim())
    .map((url) => url.trim()))].length;
  const fallback = {
    coverStatus: 'unknown',
    coverCount: knownCoverCount,
    materializedCoverCount: 0,
    reason: 'legacy-media-state-unknown',
  };
  if (value === undefined) return fallback;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (strict) throw new TypeError('inventory media state is invalid');
    return fallback;
  }
  const media = {
    coverStatus: value.coverStatus,
    coverCount: value.coverCount,
    materializedCoverCount: value.materializedCoverCount,
    reason: value.reason ?? null,
  };
  const countsValid = Number.isInteger(media.coverCount)
    && media.coverCount >= 0
    && Number.isInteger(media.materializedCoverCount)
    && media.materializedCoverCount >= 0
    && media.materializedCoverCount <= media.coverCount;
  const reasonValid = media.reason === null || typeof media.reason === 'string';
  const stateValid = (media.coverStatus === 'not-present'
      && media.coverCount === 0 && media.materializedCoverCount === 0 && media.reason === null)
    || (media.coverStatus === 'materialized'
      && media.coverCount > 0 && media.materializedCoverCount === media.coverCount && media.reason === null)
    || (media.coverStatus === 'unavailable'
      && media.coverCount > 0 && media.materializedCoverCount < media.coverCount
      && typeof media.reason === 'string' && media.reason.trim().length > 0)
    || (media.coverStatus === 'unknown'
      && media.materializedCoverCount === 0
      && typeof media.reason === 'string' && media.reason.trim().length > 0);
  if (COVER_STATUSES.has(media.coverStatus) && countsValid && reasonValid && stateValid) return media;
  if (strict) throw new TypeError('inventory media coverStatus or counts are invalid');
  return fallback;
}

export function deriveCollectionStatus({
  discoverySucceeded = true,
  metadataOnly = false,
  paginationFailed = false,
  itemStates = [],
} = {}) {
  if (!metadataOnly) {
    const unknownState = itemStates.find((state) => !['materialized', 'pending', 'failed'].includes(state));
    if (unknownState !== undefined) throw new TypeError('invalid collection item state');
  }
  if (!discoverySucceeded) return 'failed';
  if (metadataOnly) return paginationFailed ? 'partial' : 'complete';
  if (itemStates.length === 0) return paginationFailed ? 'partial' : 'complete';

  const materialized = itemStates.filter((state) => state === 'materialized').length;
  if (materialized === 0) return 'failed';
  if (paginationFailed) return 'partial';
  return materialized === itemStates.length ? 'complete' : 'partial';
}

export function handledOutcome(connector, status, outputDir, counts = {}) {
  return {
    connector,
    status,
    outputDir,
    continuable: true,
    counts: {
      discovered: 0,
      materialized: 0,
      pending: 0,
      failed: 0,
      ...counts,
    },
  };
}

export function inventoryCounts(inventory) {
  const items = Array.isArray(inventory) ? inventory : [];
  return {
    discovered: items.length,
    materialized: items.filter((item) => item?.materialization?.status === 'materialized').length,
    pending: items.filter((item) => item?.materialization?.status === 'pending').length,
    failed: items.filter((item) => item?.materialization?.status === 'failed').length,
  };
}
