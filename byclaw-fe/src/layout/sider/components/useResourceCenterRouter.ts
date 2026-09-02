import { useCallback } from 'react';
import { useLocation, useNavigate } from '@umijs/max';

interface StoredReturnLocation {
  pathname: string;
  search?: string;
  hash?: string;
  state?: unknown;
}

interface CenterRouterState {
  preserveDetailPanel?: boolean;
  resourceCenterReturnLocation?: StoredReturnLocation;
}

const getReusableReturnState = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const returnState = { ...(value as Record<string, unknown>) };
  delete returnState.autoSendContent;
  delete returnState.selectedAgentId;
  delete returnState.selectedAgentObjectType;
  delete returnState.resourceCenterReturnLocation;
  // 自动发送和员工初始化只应在首次进入会话时执行，返回中心页前的会话时不能再次触发。
  return returnState;
};

/**
 * 统一处理右侧资源面板的中心页入口：首次点击打开中心页，再次点击返回原会话，保留资源小面板。
 */
export const useResourceCenterRouter = (centerPath: string, siderKey: string, showRouter: boolean) => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as CenterRouterState;
  const isCenterPage = location.pathname.startsWith(centerPath);
  const storedReturnLocation = state.resourceCenterReturnLocation;

  const toggleCenter = useCallback(() => {
    if (!showRouter) {
      if (isCenterPage) {
        navigate('/chat', { state: { keepSiderActiveKey: siderKey } });
      } else {
        navigate(centerPath);
      }
      return;
    }

    if (isCenterPage) {
      if (storedReturnLocation?.pathname) {
        const returnState =
          storedReturnLocation.state && typeof storedReturnLocation.state === 'object'
            ? storedReturnLocation.state
            : {};
        navigate(
          {
            pathname: storedReturnLocation.pathname,
            search: storedReturnLocation.search,
            hash: storedReturnLocation.hash,
          },
          { replace: true, state: { ...returnState, preserveDetailPanel: true } }
        );
      } else {
        // 没有可恢复的来源路由时回到会话页，仍保留右侧资源工作区。
        navigate('/chat', { replace: true, state: { preserveDetailPanel: true } });
      }
      return;
    }

    const returnLocation: StoredReturnLocation = {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      state: getReusableReturnState(location.state),
    };
    navigate(centerPath, {
      state: {
        preserveDetailPanel: true,
        resourceCenterReturnLocation: returnLocation,
      },
    });
  }, [
    centerPath,
    isCenterPage,
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
    showRouter,
    siderKey,
    storedReturnLocation,
  ]);

  return { isCenterPage, toggleCenter };
};

export default useResourceCenterRouter;
