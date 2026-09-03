import { agentHandler } from '@/utils/agent';

type EmployeeChatDependencies = {
  employee: any;
  dispatch: (action: any) => void;
  navigate: (path: string, options?: any) => void;
  setAgentId?: (value: string) => void;
  setSessionId?: (value: string) => void;
  initialQuestion?: string;
};

/** 统一员工卡片、详情弹窗和会话详情中的员工跳转及状态初始化。 */
export function navigateToEmployeeChat({
  employee,
  dispatch,
  navigate,
  setAgentId,
  setSessionId,
  initialQuestion,
}: EmployeeChatDependencies) {
  const normalizedEmployee = agentHandler(employee);
  const targetId = normalizedEmployee.agentId || normalizedEmployee.id || normalizedEmployee.resourceId;
  if (!targetId) return false;

  const isGroup = `${normalizedEmployee.agentType || normalizedEmployee.workerAgentType || ''}` === '017';
  dispatch({ type: 'employees/updateEmployee', payload: { employee: normalizedEmployee } });
  setAgentId?.(`${targetId}`);
  setSessionId?.('');

  const chatParams = new URLSearchParams({
    tab: isGroup ? 'group' : 'enterprise',
    [isGroup ? 'groupCatalogId' : 'enterpriseCatalogId']: '__ALL__',
  });
  navigate(`/employees?${chatParams.toString()}`, {
    state: {
      keepSiderActiveKey: 'agent',
      selectedAgentId: `${targetId}`,
      selectedEmployee: normalizedEmployee,
      initialQuestion,
    },
  });
  return true;
}
