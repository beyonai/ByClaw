import { useCallback, useEffect, useState } from 'react';
import { queryDigitalEmployeeUseApplyAudit, type ResourceUseApplyAuditItem } from '@/pages/manager/service/resources';

export type DigitalEmployeeAuditItem = ResourceUseApplyAuditItem & {
  resourceId: string;
  resourceName: string;
  agentType?: string;
  avatar?: string;
};

export const queryDigitalEmployeeAuditList = async (): Promise<DigitalEmployeeAuditItem[]> => {
  // 数字员工首页仅查询待审核数据，用于“我的员工”和审核中心角标。
  const response: any = await queryDigitalEmployeeUseApplyAudit({ history: false });
  const auditItems = response?.data || response || [];
  return Array.isArray(auditItems) ? auditItems : auditItems.list || [];
};

export default function useDigitalEmployeeAuditCount() {
  const [rows, setRows] = useState<DigitalEmployeeAuditItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      setRows(await queryDigitalEmployeeAuditList());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { count: rows.length, rows, refresh };
}
