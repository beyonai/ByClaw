import { useEffect, useState } from 'react';
import { querySessionDataSources } from '@/service/projectDataSources';

/** 侧栏与加号菜单共用会话数据可见性，隔离项目切换和过期请求。 */
export const useSessionDataSourcesVisible = (sessionId?: string, projectId?: number, refreshKey = 0) => {
  const resolvedProjectId = Number(projectId);
  const [dataSourceAvailability, setDataSourceAvailability] = useState<{
    sessionId: string;
    projectId: number;
    hasData: boolean;
  }>();
  const showDataSources = Boolean(
    sessionId &&
      resolvedProjectId > 0 &&
      dataSourceAvailability?.sessionId === sessionId &&
      dataSourceAvailability?.projectId === resolvedProjectId &&
      dataSourceAvailability?.hasData
  );
  // 按当前会话的实际可见数据决定入口；切换会话后不沿用上一个会话的结果。
  useEffect(() => {
    let disposed = false;
    if (!sessionId || !Number.isFinite(resolvedProjectId) || resolvedProjectId <= 0) return;
    void querySessionDataSources(sessionId)
      .then((result) => {
        if (!disposed) {
          setDataSourceAvailability({ sessionId, projectId: resolvedProjectId, hasData: result.total > 0 });
        }
      })
      .catch(() => {
        if (!disposed) {
          setDataSourceAvailability({ sessionId, projectId: resolvedProjectId, hasData: false });
        }
      });
    return () => {
      disposed = true;
    };
  }, [resolvedProjectId, sessionId, refreshKey]);

  return showDataSources;
};
