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
    const defaultEmployeeId = defaultDigEmployeeId || userInfo?.defaultDigEmployeeId;
    const selectedId = selectedAgentId || defaultEmployeeId;
    // employeesList 的 discover 数据同时包含 id/resourceId，优先于仅用于默认员工展示的 agentList。
    const allAgents = [...(employeesList || []), ...(agentList || [])];
    const matchedAgent = allAgents.find((item) => matchAgentById(item, selectedId));
    const selectedGlobalAgent = agentInfo && matchAgentById(agentInfo, selectedAgentId) ? agentInfo : undefined;
    // 会话态 agentId 来自 session.objectId。匹配不到员工资源时不能将它直接当作 resourceId；
    // 输入框 @ 和默认员工 ID 的来源字段本身就是 resourceId，可以在列表尚未加载时使用。
    const trustedSourceId = siderAgentId || (!selectedAgentId ? defaultEmployeeId : undefined);
    const resourceId = selectedGlobalAgent?.resourceId || matchedAgent?.resourceId || trustedSourceId;
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
