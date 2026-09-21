import type { IOnOkParams } from '@/components/Resources/components/ResourceFilter';
import { PERMISSION_AUTHORIZED_TO_ME_VALUE, PERMISSION_CREATED_BY_ME_VALUE } from '@/components/Resources/constants';

export const buildDigitalEmployeeFilterParam = (
  _activeTab: string,
  filterParam?: IOnOkParams,
  source: 'official' | 'available' = 'available'
) => {
  const permission = filterParam?.permission;
  const employeeType = filterParam?.digitalEmployeeType;
  let type: string | undefined;
  if (source === 'available') {
    if (permission === PERMISSION_CREATED_BY_ME_VALUE) {
      type = 'owner';
    } else if (permission === PERMISSION_AUTHORIZED_TO_ME_VALUE) {
      type = 'authorize';
    }
  }

  const employeeTypeParams = employeeType
    ? {
        ...(employeeType.includes('PERSONAL') ? { ownerType: 'personal' } : { ownerType: 'enterprise' }),
        // discover 通过 includeEmployeeGroup 排除员工组，可用列表使用 excludeEmployeeGroup。
        ...(employeeType.includes('GROUP')
          ? { agentType: '017' }
          : source === 'official'
          ? { includeEmployeeGroup: false }
          : { excludeEmployeeGroup: true }),
      }
    : {};

  return {
    // 官方推荐固定查询已上架，忽略旧筛选值，确保首屏、搜索和分页使用同一状态口径。
    ...(source === 'official'
      ? { resourceStatus: '2', excludeDeleted: true }
      : filterParam?.resourceStatus !== undefined && filterParam?.resourceStatus !== ''
      ? { resourceStatus: filterParam.resourceStatus }
      : {}),
    // 我可用接口使用 type=owner/authorize；官方推荐 discover 接口使用通用 permission 枚举。
    ...(source === 'official' && permission ? { permission } : {}),
    ...(type ? { type } : {}),
    ...employeeTypeParams,
  };
};
