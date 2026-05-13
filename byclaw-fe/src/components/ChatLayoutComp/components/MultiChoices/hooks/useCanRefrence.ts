import { useState, useMemo, useEffect } from 'react';
import { useSelector } from '@umijs/max';

import { isOpenClawAgent } from '@/utils/openClaw/utils';
import { agentTypeMap } from '@/constants/agent';

import type { IAgentCache } from '@/typescript/agent';
import type { IState as UseEmployeesIState } from '@/models/useEmployees';

export default function useCanRefrence() {
  const [canRefrence, setCanRefrence] = useState(false);

  const { agentList, employeesList } = useSelector(({ employees }: { employees: UseEmployeesIState }) => employees);

  const openClawAgent = useMemo(() => {
    return employeesList.find((item: IAgentCache) => isOpenClawAgent(item));
  }, [employeesList]);

  const writerAgent = useMemo(() => {
    return [...agentList, ...employeesList].find((item) => item.agentType === agentTypeMap.writer);
  }, [agentList, employeesList]);

  useEffect(() => {
    setCanRefrence(!!openClawAgent || !!writerAgent);
  }, [openClawAgent, writerAgent]);

  return {
    canRefrence,
  };
}
