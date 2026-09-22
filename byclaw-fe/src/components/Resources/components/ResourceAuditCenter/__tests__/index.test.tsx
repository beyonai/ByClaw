import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResourceAuditCenter from '..';
import { getBaseResourceBizTypeList } from '../../../utils';
import { approveUseApply, queryResourceUseApplyAudit } from '@/pages/manager/service/resources';

jest.mock('@umijs/max', () => {
  const intl = { formatMessage: ({ id }: { id: string }) => id };
  return { useIntl: () => intl };
});

jest.mock('@/pages/manager/service/resources', () => ({
  approveUseApply: jest.fn(() => Promise.resolve()),
  queryResourceUseApplyAudit: jest.fn(),
  rejectUseApply: jest.fn(() => Promise.resolve()),
}));

const mockQueryResourceUseApplyAudit = queryResourceUseApplyAudit as jest.Mock;

describe('ResourceAuditCenter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResourceUseApplyAudit.mockImplementation(({ history }: { history: boolean }) =>
      Promise.resolve({
        data: history
          ? [
              {
                privilegeGrantId: 'grant-history',
                resourceId: 'resource-1',
                resourceName: '历史技能',
                resourceBizType: 'SKILL',
                userId: 'user-1',
                userName: '申请人',
                applyTime: '2026-09-20 10:00:00',
                applyStatus: '审核通过',
              },
            ]
          : [
              {
                privilegeGrantId: 'grant-pending',
                resourceId: 'resource-2',
                resourceName: '待审核技能',
                resourceBizType: 'SKILL',
                userId: 'user-2',
                userName: '待审核申请人',
                applyTime: '2026-09-20 11:00:00',
                applyStatus: 'P',
              },
            ],
      })
    );
  });

  it('loads pending resource applications and lazily loads history', async () => {
    render(<ResourceAuditCenter resourceBizTypeList={['SKILL']} />);

    await waitFor(() => expect(screen.getByText('待审核技能')).toBeInTheDocument());
    expect(mockQueryResourceUseApplyAudit).toHaveBeenCalledWith({
      history: false,
      resourceBizTypeList: ['SKILL'],
    });

    fireEvent.click(screen.getByText('resourceCenter.reviewHistory'));
    await waitFor(() => expect(screen.getByText('历史技能')).toBeInTheDocument());
    expect(mockQueryResourceUseApplyAudit).toHaveBeenCalledWith({
      history: true,
      resourceBizTypeList: ['SKILL'],
    });
  });

  it('approves a pending resource application', async () => {
    render(<ResourceAuditCenter resourceBizTypeList={['SKILL']} />);
    await waitFor(() => expect(screen.getByText('待审核技能')).toBeInTheDocument());

    fireEvent.click(screen.getByText('resourceCenter.approve'));
    expect(await screen.findByText('resourceCenter.confirmApprove')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
    await waitFor(() =>
      expect(approveUseApply).toHaveBeenCalledWith({ resourceId: 'resource-2', applyUserId: 'user-2' })
    );
    // 接口调用发生在 await 之前，需等待成功后的列表状态更新完成。
    await waitFor(() => expect(screen.queryByText('待审核技能')).not.toBeInTheDocument());
  });

  it.each(['SKILL', 'KG_DOC', 'TOOL'])('isolates pending, history and counts for %s', async (resourceType) => {
    const resourceBizTypeList = getBaseResourceBizTypeList(resourceType);
    const types = ['DIG_EMPLOYEE', 'SKILL', 'KG_DOC', 'KG_QA', 'KG_TERM', 'MCP', 'TOOLKIT', 'AGENT'];
    mockQueryResourceUseApplyAudit.mockImplementation(({ history }: { history: boolean }) =>
      Promise.resolve({
        data: types.map((type) => ({
          privilegeGrantId: `grant-${type}`,
          resourceId: type,
          resourceName: `${history ? 'history' : 'pending'}-${type}`,
          resourceBizType: type,
          userId: 'applicant',
          applyStatus: history ? 'X' : 'P',
        })),
      })
    );
    const onPendingCountChange = jest.fn();
    render(
      <ResourceAuditCenter resourceBizTypeList={resourceBizTypeList} onPendingCountChange={onPendingCountChange} />
    );

    for (const history of [false, true]) {
      if (history) fireEvent.click(screen.getByText('resourceCenter.reviewHistory'));
      const prefix = history ? 'history' : 'pending';
      await screen.findByText(`${prefix}-${resourceBizTypeList[0]}`);
      expect(mockQueryResourceUseApplyAudit).toHaveBeenCalledWith({ history, resourceBizTypeList });
      for (const type of types) {
        if (resourceBizTypeList.includes(type)) {
          expect(screen.getByText(`${prefix}-${type}`)).toBeInTheDocument();
        } else {
          expect(screen.queryByText(`${prefix}-${type}`)).not.toBeInTheDocument();
        }
      }
      // 筛选条只保留待审核和历史切换，不重复显示模块名称。
      const filter = screen.getByText('resourceCenter.reviewHistory').closest('.ant-segmented')!.parentElement!;
      expect(filter).not.toHaveTextContent(/resource\.knowledge|common\.skill|common\.tool/);
    }
    expect(onPendingCountChange).toHaveBeenLastCalledWith(resourceBizTypeList.length);
  });
});
