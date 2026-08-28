import { useCallback, useEffect, useState } from 'react';
import { queryManagedEnterpriseEmployees, queryMyCreated } from '@/service/digitalEmployees';
import { queryUseApplyList } from '@/pages/manager/service/resources';

const getResourceList = (value: any) => value?.list || value?.data?.list || [];

export const queryDigitalEmployeeAuditCount = async () => {
  const queryResources = async (request: typeof queryMyCreated, agentType?: string) => {
    const response = await request({
      pageNum: 1,
      pageSize: 200,
      permission: 'PENDING_MY_APPROVAL',
      agentType,
    });
    return getResourceList(response);
  };

  const resources = (
    await Promise.all([
      queryResources(queryMyCreated),
      queryResources(queryMyCreated, '017'),
      queryResources(queryManagedEnterpriseEmployees),
      queryResources(queryManagedEnterpriseEmployees, '017'),
    ])
  ).flat();

  const uniqueResourceIds = Array.from(
    new Set(resources.map((item: any) => `${item.resourceId || item.id || item.agentId || ''}`).filter(Boolean))
  );
  const applyLists = await Promise.all(
    uniqueResourceIds.map((resourceId) => queryUseApplyList({ resourceId }).catch(() => []))
  );
  return applyLists.reduce((total, response: any) => total + (response?.data || response || []).length, 0);
};

export default function useDigitalEmployeeAuditCount() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setCount(await queryDigitalEmployeeAuditCount());
    } catch {
      setCount(0);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { count, refresh };
}
