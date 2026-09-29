import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DetailPanelOptions } from '../sider/siderContentContext';

interface PanelEntry {
  content: React.ReactNode;
  options: DetailPanelOptions;
  id?: number;
}

export const useDetailPanelState = () => {
  const [basePanel, setBasePanel] = useState<PanelEntry | null>(null);
  const [temporaryPanel, setTemporaryPanel] = useState<PanelEntry | null>(null);
  const sequence = useRef(0);

  const dismissTemporaryDetailPanel = useCallback(() => setTemporaryPanel(null), []);
  const clearDetailPanel = useCallback(() => {
    setBasePanel(null);
    setTemporaryPanel(null);
  }, []);
  const openDetailPanel = useCallback((content: React.ReactNode, options: DetailPanelOptions = {}) => {
    setBasePanel(content ? { content, options } : null);
    setTemporaryPanel(null);
  }, []);
  const openTemporaryDetailPanel = useCallback(
    (render: (onClose: () => void) => React.ReactNode, options: DetailPanelOptions = {}) => {
      const id = ++sequence.current;

      // 只保留最后一次详情；旧详情的异步关闭回调不能关闭新详情或恢复已失效的面板。
      const close = () => setTemporaryPanel((current) => (current?.id === id ? null : current));
      setTemporaryPanel({ id, content: render(close), options });
    },
    []
  );

  return {
    basePanel,
    temporaryPanel,
    activePanel: temporaryPanel || basePanel,
    openDetailPanel,
    openTemporaryDetailPanel,
    dismissTemporaryDetailPanel,
    clearDetailPanel,
  };
};

export const DetailPanelContent = ({
  basePanel,
  temporaryPanel,
}: Pick<ReturnType<typeof useDetailPanelState>, 'basePanel' | 'temporaryPanel'>) => (
  <>
    {/* 固定位置保留原实例与 DOM，详情关闭后无需重新加载列表或重建页签。 */}
    <div hidden={!!temporaryPanel} style={{ height: '100%' }}>
      {basePanel?.content}
    </div>
    {temporaryPanel && (
      <div key={temporaryPanel.id} style={{ height: '100%' }}>
        {temporaryPanel.content}
      </div>
    )}
  </>
);

export const useDetailPanelLifecycle = ({
  scope,
  pathname,
  preserveDetailPanel,
  clearDetailPanel,
  dismissTemporaryDetailPanel,
}: {
  scope: string;
  pathname: string;
  preserveDetailPanel: boolean;
} & Pick<ReturnType<typeof useDetailPanelState>, 'clearDetailPanel' | 'dismissTemporaryDetailPanel'>) => {
  const previousScope = useRef(scope);
  useLayoutEffect(() => {
    if (previousScope.current !== scope) {
      previousScope.current = scope;

      // 先清理旧员工/会话，再由聊天组件的 effect 注册新工作区。
      clearDetailPanel();
    }
  }, [clearDetailPanel, scope]);

  useEffect(() => {
    // 中心入口只保留来源面板，临时详情不能跟随路由迁移。
    if (preserveDetailPanel) dismissTemporaryDetailPanel();
    else clearDetailPanel();
  }, [clearDetailPanel, dismissTemporaryDetailPanel, pathname, preserveDetailPanel]);

  useEffect(() => {
    // 浏览器会重用 history.state 的保留标记，前进/后退时需显式清理失效上下文。
    window.addEventListener('popstate', clearDetailPanel);
    return () => window.removeEventListener('popstate', clearDetailPanel);
  }, [clearDetailPanel]);
};
