import { clearCache, useRequest } from 'ahooks';
import { useCallback } from 'react';
import { useLocation, useSelector } from '@umijs/max';
import { queryResourceUseApplyAudit } from '@/pages/manager/service/resources';
import { getPublicationPendingCount } from '@/service/employeePublication';
import {
  ALL_APPROVAL_BIZ_TYPES,
  APPROVAL_TABS,
  EMPTY_APPROVAL_COUNTS,
  getResourceAuditItems,
  type ApprovalCounts,
} from '@/utils/approvalCenter';

export const queryApprovalPendingCounts = async (): Promise<ApprovalCounts> => {
  // 聚合接口继续由后端按当前用户的审核权限过滤，员工发布保留独立计数链路。
  const [resources, publications] = await Promise.allSettled([
    queryResourceUseApplyAudit({ history: false, resourceBizTypeList: ALL_APPROVAL_BIZ_TYPES }),
    getPublicationPendingCount(),
  ]);
  const counts = { ...EMPTY_APPROVAL_COUNTS };
  if (resources.status === 'fulfilled') {
    APPROVAL_TABS.forEach((tab) => {
      counts[tab.key] = getResourceAuditItems(resources.value, tab.resourceBizTypeList).length;
    });
  }
  if (publications.status === 'fulfilled') counts.employee += Math.max(0, Number(publications.value) || 0);
  return counts;
};

export default function useApprovalPendingCounts() {
  const { pathname } = useLocation();
  const userId = useSelector(({ user }: any) => user.userInfo?.userId);
  const cacheKey = `approval-center-pending-${userId || ''}`;
  // 侧栏和审批页共享请求缓存；按账号隔离，路由切换或审批成功后刷新。
  const { data, refresh: refreshRequest } = useRequest(
    async () => ({ userId, counts: await queryApprovalPendingCounts() }),
    {
      ready: !!userId,
      cacheKey,
      staleTime: 0,
      refreshDeps: [pathname, userId],
    }
  );
  const refresh = useCallback(() => {
    // 审批动作必须跳过缓存，确保成功后角标即时跟随服务端结果。
    clearCache(cacheKey);
    refreshRequest();
  }, [cacheKey, refreshRequest]);
  const counts = data && data.userId === userId && userId ? data.counts : EMPTY_APPROVAL_COUNTS;
  return { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0), refresh };
}
