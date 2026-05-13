import { useCallback } from 'react';
import TrackerInstance, { getTrackerInfo } from '@/utils/tracker';
import { IAgentCache } from '@/typescript/agent';
import { ResourceTypeMap } from '@/constants/resource';
import { getAgentPath } from '@/utils/agent';
import useGlobal from './useGlobal';
import { trackerElementMap } from '@/constants/tracker';

export const useTracker = () => {
  const { agentInfo, platform } = useGlobal();
  const { agentId } = agentInfo || {};
  const trackerEmployeeClick = useCallback((employee: IAgentCache, trackerType: keyof typeof trackerElementMap) => {
    if (`${employee.agentId}` === `${agentId}`) {
      return;
    }

    TrackerInstance?.track('CLICK', {
      ...getTrackerInfo(trackerType, {
        objectId: employee.agentId,
        objectType: ResourceTypeMap.digitalEmployee,
        pagePath: getAgentPath(employee),
        pageTitle: employee.name,
        platform,
      }),
    });
  }, []);

  return {
    trackerEmployeeClick,
  };
};

export default useTracker;
