import type { IOnOkParams } from '@/components/Resources/components/ResourceFilter';
import { PERMISSION_AUTHORIZED_TO_ME_VALUE, PERMISSION_CREATED_BY_ME_VALUE } from '@/components/Resources/constants';

export const buildDigitalEmployeeFilterParam = (
  _activeTab: string,
  filterParam?: IOnOkParams,
  source: 'official' | 'available' | 'favorites' = 'available'
) => {
  const permission = filterParam?.permission;
  // 企业推荐移除类型筛选后忽略旧值，避免隐藏条件继续限制首屏、搜索和分页查询。
  const employeeType = source === 'official' ? undefined : filterParam?.digitalEmployeeType;
  const discoverSource = source !== 'available';
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
      // 收藏使用 discover 的类型参数，可用列表使用 excludeEmployeeGroup 排除员工组。
      ...(employeeType.includes('GROUP')
        ? { agentType: '017' }
        : discoverSource
          ? { includeEmployeeGroup: false }
          : { excludeEmployeeGroup: true }),
    }
    : {};

  return {
    // 企业推荐和收藏固定查询已上架，忽略旧状态值，保证搜索与分页的状态口径一致。
    ...(discoverSource
      ? { resourceStatus: '2', excludeDeleted: true }
      : filterParam?.resourceStatus !== undefined && filterParam?.resourceStatus !== ''
        ? { resourceStatus: filterParam.resourceStatus }
        : {}),
    // 我可用接口使用 type=owner/authorize；企业推荐和收藏使用通用 permission 枚举。
    ...(discoverSource && permission ? { permission } : {}),
    ...(type ? { type } : {}),
    ...employeeTypeParams,
  };
};
