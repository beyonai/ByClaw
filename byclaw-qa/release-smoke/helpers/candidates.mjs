export const employeeName = (item) => String(item.resourceName || item.name || item.id || '');

// The All panel excludes placeholder rows and the special network-search agent.
// Employee groups stay in this array because they occupy positions in the UI.
export function visibleCandidates(list) {
  return list.filter((item) => (item.agentId || item.resourceId || item.id) &&
    String(item.agentType || item.workerAgentType || '') !== '012');
}

export function targetIndex(list, employee) {
  const indices = list.flatMap((item, index) => [item.id, item.resourceId, item.resourceCode, item.agentId]
    .filter((key) => key !== undefined && key !== null).map(String).some((key) => employee.ids.includes(key)) ? [index] : []);
  if (indices.length !== 1) throw new Error('搜索结果无法唯一对应本轮冻结的员工 ID');
  return indices[0];
}
