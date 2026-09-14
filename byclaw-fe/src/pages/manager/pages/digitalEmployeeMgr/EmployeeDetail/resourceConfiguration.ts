interface EmployeeResourceIdentity {
  ownerType?: string;
  resourceCode?: string;
}

export const isSuperAssistant = (employee?: EmployeeResourceIdentity | null): boolean =>
  ['personal', 'personal_default'].includes(employee?.ownerType || '') &&
  (employee?.resourceCode || '').endsWith('_main');

// 超级助手的资源配置在编辑页不可修改，沿用详情中的完整关联，包含页面未展示的历史本体资源。
export const preserveSuperAssistantResourceConfiguration = <T extends Record<string, unknown>>(
  payload: T,
  detail?: (EmployeeResourceIdentity & Record<string, unknown>) | null
): T => {
  if (!isSuperAssistant(detail)) return payload;

  const preserved: Record<string, unknown> = { ...payload };
  ['relIds', 'relTools', 'skills', 'relSkills', 'employeeGroupMembers'].forEach((key) => {
    if (detail?.[key] !== undefined) {
      preserved[key] = detail[key];
    }
  });
  return preserved as T;
};
