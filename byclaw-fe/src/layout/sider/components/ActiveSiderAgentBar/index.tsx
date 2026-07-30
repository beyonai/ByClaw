import React, { useMemo } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import { getAgentChatAvatar } from '@/utils/agent';
import type { IAgentCache } from '@/typescript/agent';
import type { IState as IEmployeesState } from '@/models/useEmployees';
import styles from './index.module.less';

interface ActiveSiderAgent {
  resourceId?: string;
  name: string;
  avatar?: string;
}

const matchAgentById = (item: IAgentCache, resourceId?: string | number) => {
  if (!resourceId) return false;
  return [`${item.agentId}`, `${item.id}`, `${item.resourceId}`].includes(`${resourceId}`);
};

export const useActiveSiderAgent = (): ActiveSiderAgent => {
  const { agentId, agentInfo, siderAgentId } = useGlobal();
  const { userInfo, defaultDigEmployeeId, employeesList, agentList } = useSelector(
    ({ user, employees }: { user: any; employees: IEmployeesState }) => ({
      userInfo: user.userInfo,
      defaultDigEmployeeId: employees.defaultDigEmployeeId,
      employeesList: employees.employeesList,
      agentList: employees.agentList,
    })
  );

  return useMemo(() => {
    // 输入框存在手动 @ 时优先跟随最后一个员工，否则回退到当前会话或默认员工。
    const selectedAgentId = siderAgentId || agentId || agentInfo?.agentId;
    const resourceId = selectedAgentId || defaultDigEmployeeId || userInfo?.defaultDigEmployeeId;
    const allAgents = [...(agentList || []), ...(employeesList || [])];
    const matchedAgent = allAgents.find((item) => matchAgentById(item, resourceId));
    const selectedGlobalAgent = agentInfo && matchAgentById(agentInfo, selectedAgentId) ? agentInfo : undefined;
    const name =
      selectedGlobalAgent?.resourceName ||
      selectedGlobalAgent?.name ||
      matchedAgent?.resourceName ||
      matchedAgent?.name ||
      matchedAgent?.resourceCode ||
      `${resourceId || ''}`;
    const avatar =
      selectedGlobalAgent?.chatAvatar ||
      selectedGlobalAgent?.avatar ||
      matchedAgent?.chatAvatar ||
      matchedAgent?.avatar;

    return {
      resourceId: resourceId ? `${resourceId}` : undefined,
      name,
      avatar,
    };
  }, [
    agentId,
    agentInfo,
    agentList,
    defaultDigEmployeeId,
    employeesList,
    siderAgentId,
    userInfo?.defaultDigEmployeeId,
  ]);
};

interface ActiveSiderAgentBarProps {
  agent?: ActiveSiderAgent;
}

const ActiveSiderAgentBar: React.FC<ActiveSiderAgentBarProps> = ({ agent }) => {
  const intl = useIntl();
  const fallbackAgent = useActiveSiderAgent();
  const currentAgent = agent || fallbackAgent;

  if (!currentAgent.resourceId) {
    return null;
  }

  return (
    <div className={styles.agentBar}>
      <span className={styles.contextLabel}>
        {intl.formatMessage({ id: 'sider.currentDigitalEmployee', defaultMessage: '当前数字员工' })}
      </span>
      <span className={styles.avatar}>{getAgentChatAvatar(currentAgent.avatar)}</span>
      <span className={styles.name} title={currentAgent.name}>
        {currentAgent.name}
      </span>
    </div>
  );
};

export default ActiveSiderAgentBar;
