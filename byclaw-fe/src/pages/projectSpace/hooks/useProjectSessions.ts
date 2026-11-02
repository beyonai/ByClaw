import { useMemo } from 'react';

import getSessionTimestamp from '@/utils/getSessionTimestamp';
import type { ProjectSpace } from '../types';

export const useProjectSessions = (project?: ProjectSpace) => {
  const sessions = useMemo(() => {
    const list = project?.sessions || [];
    // 项目空间会话默认按最近更新时间靠前，和现有会话列表的浏览习惯保持一致。
    return [...list].sort((left, right) => {
      const leftTime = getSessionTimestamp(left.updateTime || left.createTime);
      const rightTime = getSessionTimestamp(right.updateTime || right.createTime);
      return rightTime - leftTime;
    });
  }, [project]);

  return {
    sessions,
    total: sessions.length,
  };
};
