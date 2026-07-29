import { useMemo } from 'react';
import type { ProjectSpace } from '../types';

export const useProjectSessions = (project?: ProjectSpace) => {
  const sessions = useMemo(() => {
    const list = project?.sessions || [];
    // 项目空间会话默认按最近更新时间靠前，和现有会话列表的浏览习惯保持一致。
    return [...list].sort((a, b) => {
      const leftTime = new Date(a.updateTime || a.createTime || 0).getTime();
      const rightTime = new Date(b.updateTime || b.createTime || 0).getTime();
      return rightTime - leftTime;
    });
  }, [project]);

  return {
    sessions,
    total: sessions.length,
  };
};
