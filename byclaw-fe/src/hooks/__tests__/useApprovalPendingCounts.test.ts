import { act, renderHook, waitFor } from '@testing-library/react';
import { clearCache } from 'ahooks';
import useApprovalPendingCounts, { queryApprovalPendingCounts } from '../useApprovalPendingCounts';
import { queryResourceUseApplyAudit } from '@/pages/manager/service/resources';
import { getPublicationPendingCount } from '@/service/employeePublication';
import { ALL_APPROVAL_BIZ_TYPES } from '@/utils/approvalCenter';

let mockUserId: string | undefined = 'user-1';
let mockPathname = '/approvalCenter';
jest.mock('@umijs/max', () => ({
  useLocation: () => ({ pathname: mockPathname }),
  useSelector: (selector: (state: any) => any) => selector({ user: { userInfo: { userId: mockUserId } } }),
}));
jest.mock('@/pages/manager/service/resources', () => ({ queryResourceUseApplyAudit: jest.fn() }));
jest.mock('@/service/employeePublication', () => ({ getPublicationPendingCount: jest.fn() }));

describe('shared approval pending counts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
    mockUserId = 'user-1';
    mockPathname = '/approvalCenter';
    (queryResourceUseApplyAudit as jest.Mock).mockResolvedValue({
      data: {
        rows: [
          ...ALL_APPROVAL_BIZ_TYPES.map((type) => ({ resourceId: type, resourceBizType: type.toLowerCase() })),
          { resourceId: 'unrelated', resourceBizType: 'MODEL' },
          { resourceBizType: 'SKILL' },
          { resourceId: '', resourceBizType: 'SKILL' },
        ],
      },
    });
    (getPublicationPendingCount as jest.Mock).mockResolvedValue(2);
  });
  afterEach(() => clearCache());

  it('counts all four scopes, excludes invalid resources and includes employee publication', async () => {
    expect(await queryApprovalPendingCounts()).toEqual({ employee: 3, skill: 1, knowledge: 3, tool: 3 });
    expect(queryResourceUseApplyAudit).toHaveBeenCalledWith({
      history: false,
      resourceBizTypeList: ALL_APPROVAL_BIZ_TYPES,
    });
  });

  it.each(['resources', 'publications'])('keeps the available counts when %s fails', async (source) => {
    if (source === 'resources') (queryResourceUseApplyAudit as jest.Mock).mockRejectedValue(new Error('failed'));
    else (getPublicationPendingCount as jest.Mock).mockRejectedValue(new Error('failed'));
    expect(await queryApprovalPendingCounts()).toEqual(
      source === 'resources'
        ? { employee: 2, skill: 0, knowledge: 0, tool: 0 }
        : { employee: 1, skill: 1, knowledge: 3, tool: 3 }
    );
  });

  it('shares refreshed counts between the sidebar and page subscribers', async () => {
    const { result } = renderHook(() => ({ sidebar: useApprovalPendingCounts(), page: useApprovalPendingCounts() }));
    await waitFor(() => expect(result.current.sidebar.total).toBe(10));
    expect(result.current.page.total).toBe(10);
    (queryResourceUseApplyAudit as jest.Mock).mockResolvedValue({ data: [] });
    (getPublicationPendingCount as jest.Mock).mockResolvedValue(0);
    // 审批成功在同一毫秒触发时，也必须重新获取数据。
    await act(async () => {
      result.current.page.refresh();
    });
    await waitFor(() => expect(result.current.sidebar.total).toBe(0));
    expect(result.current.page.total).toBe(0);
  });

  it('hides the previous account counts during logout and loads counts after account switching', async () => {
    const { result, rerender } = renderHook(() => useApprovalPendingCounts());
    await waitFor(() => expect(result.current.total).toBe(10));
    mockUserId = undefined;
    rerender();
    expect(result.current.total).toBe(0);
    (queryResourceUseApplyAudit as jest.Mock).mockResolvedValue({ data: [] });
    (getPublicationPendingCount as jest.Mock).mockResolvedValue(0);
    mockUserId = 'user-2';
    (getPublicationPendingCount as jest.Mock).mockResolvedValue(5);
    rerender();
    expect(result.current.total).toBe(0);
    await waitFor(() => expect(result.current.total).toBe(5));
  });
});
