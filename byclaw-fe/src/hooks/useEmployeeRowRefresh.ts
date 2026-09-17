import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { getCompositeAppInfo } from '@/service/digitalEmployees';
import { agentHandler } from '@/utils/agent';
import type { IAgentCache } from '@/typescript/agent';

export const employeeRowId = (employee: any) =>
  `${employee?.resourceId ?? employee?.id ?? employee?.agentId ?? ''}`;

const requests = new Map<string, Promise<any>>();
const ROW_CHANGED = 'digital-employee-row-changed';

// 一次操作只查询这一条员工详情，权限随详情返回；多个已挂载列表共用同一个请求。
export const refreshEmployeeRow = (resourceId: string) => {
  if (!resourceId) return Promise.resolve(undefined);
  const pending = requests.get(resourceId);
  if (pending) return pending;
  const request = getCompositeAppInfo({ resourceId })
    .then((response: any) => {
      const detail = response?.data || response;
      if (!detail || employeeRowId(detail) !== resourceId) return undefined;
      const row = {
        ...detail,
        ...detail.operationPermissions,
        operationPermissionsLoaded: !!detail.operationPermissions,
        approveStatus: detail.operationPermissions?.useApplyPending ? 'S' : '',
      };
      window.dispatchEvent(new CustomEvent(ROW_CHANGED, { detail: row }));
      return row;
    })
    .finally(() => requests.delete(resourceId));
  requests.set(resourceId, request);
  return request;
};

// 操作成功后先用本地结果更新当前行，避免等待详情请求期间继续展示旧状态。
export const updateEmployeeRow = (row: Record<string, any>) => {
  const resourceId = employeeRowId(row);
  if (!resourceId) return;
  window.dispatchEvent(new CustomEvent(ROW_CHANGED, { detail: { ...row, resourceId } }));
};

export const removeEmployeeRow = (resourceId: string) => {
  window.dispatchEvent(new CustomEvent(ROW_CHANGED, { detail: { resourceId, resourceStatus: -1 } }));
};

export default function useEmployeeRowRefresh(
  list: IAgentCache[],
  setList: Dispatch<SetStateAction<IAgentCache[]>>,
  onRemove: () => void,
  shouldKeepRow: (row: IAgentCache) => boolean = () => true
) {
  const listRef = useRef(list);
  const onRemoveRef = useRef(onRemove);
  const shouldKeepRowRef = useRef(shouldKeepRow);
  listRef.current = list;
  onRemoveRef.current = onRemove;
  shouldKeepRowRef.current = shouldKeepRow;

  useEffect(() => {
    const onChange = (event: Event) => {
      const row = (event as CustomEvent).detail;
      const id = employeeRowId(row);
      const currentEmployee = listRef.current.find((employee) => employeeRowId(employee) === id);
      if (!id || !currentEmployee) return;
      // 用当前行与详情合并后的数据判断筛选条件，兼容详情接口暂未返回状态字段的旧数据。
      const nextEmployee = agentHandler({ ...currentEmployee, ...row });
      const keepRow =
        `${nextEmployee.resourceStatus ?? nextEmployee.metaStatus ?? ''}` !== '-1' &&
        shouldKeepRowRef.current(nextEmployee);
      if (!keepRow) {
        listRef.current = listRef.current.filter((employee) => employeeRowId(employee) !== id);
        onRemoveRef.current();
      }
      setList((current) =>
        current.flatMap((employee) => {
          if (employeeRowId(employee) !== id) return [employee];
          if (!keepRow) return [];
          return [agentHandler({ ...employee, ...row })];
        })
      );
    };
    window.addEventListener(ROW_CHANGED, onChange);
    return () => window.removeEventListener(ROW_CHANGED, onChange);
  }, [setList]);

  return useCallback((employee: any) => {
    const id = typeof employee === 'string' ? employee : employeeRowId(employee);
    if (!listRef.current.some((item) => employeeRowId(item) === id)) return Promise.resolve(undefined);
    return refreshEmployeeRow(id);
  }, []);
}
