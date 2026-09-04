import { useMemo } from 'react';
import { useLocation } from '@umijs/max';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { resolveResourceInstallTargetContext, type ResourceInstallTargetContext } from './resourceInstallContext';

/** 入口二始终跟随右侧“当前数字员工”的实时值，避免继续使用进入资源中心时留下的旧员工 ID。 */
const useResourceInstallTargetContext = (): ResourceInstallTargetContext => {
  const location = useLocation();
  const activeSiderAgent = useActiveSiderAgent();
  const routeContext = useMemo(() => resolveResourceInstallTargetContext(location.state), [location.state]);

  return useMemo(() => {
    if (routeContext.mode === 'select') return routeContext;
    if (!activeSiderAgent.resourceId) {
      return {
        mode: 'unavailable',
        digitalEmployeeName: activeSiderAgent.name || routeContext.digitalEmployeeName,
      };
    }
    return {
      mode: 'fixed',
      digitalEmployeeId: activeSiderAgent.resourceId,
      digitalEmployeeName: activeSiderAgent.name || routeContext.digitalEmployeeName || activeSiderAgent.resourceId,
    };
  }, [activeSiderAgent.name, activeSiderAgent.resourceId, routeContext]);
};

export default useResourceInstallTargetContext;
