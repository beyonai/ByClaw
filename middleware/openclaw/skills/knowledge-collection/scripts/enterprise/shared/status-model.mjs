export const SOURCE_IDENTITY = {
  dingtalk: { connector: 'dws', source: 'dws', backend: 'dws', sourceSkill: 'dws' },
  feishu: { connector: 'fws', source: 'fws', backend: 'lark-cli', sourceSkill: 'fws' },
  wecom: { connector: 'wecom', source: 'wecom', backend: 'wecom-cli', sourceSkill: 'wecomcli' },
  ima: { connector: 'ima', source: 'ima', backend: 'ima', sourceSkill: 'ima-skill' },
};

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
