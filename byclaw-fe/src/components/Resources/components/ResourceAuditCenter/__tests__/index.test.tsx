import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResourceAuditCenter from '..';
import { getBaseResourceBizTypeList } from '../../../utils';
import { approveUseApply, queryResourceUseApplyAudit, rejectUseApply } from '@/pages/manager/service/resources';

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
    expect(screen.getByRole('columnheader', { name: 'resource.auditApplicationType' })).toBeInTheDocument();
    expect(screen.getByText('resource.resourceUseAudit')).toBeInTheDocument();
    expect(mockQueryResourceUseApplyAudit).toHaveBeenCalledWith({
      history: false,
      resourceBizTypeList: ['SKILL'],
    });

    fireEvent.click(screen.getByText('resourceCenter.reviewHistory'));
    await waitFor(() => expect(screen.getByText('历史技能')).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: 'resource.auditApplicationType' })).toBeInTheDocument();
    expect(screen.getByText('resource.resourceUseAudit')).toBeInTheDocument();
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

  it.each(['approve', 'reject'])(
    'routes publication %s through the shared audit endpoint with its type',
    async (action) => {
      mockQueryResourceUseApplyAudit.mockResolvedValue({
        data: [
          {
            privilegeGrantId: 'publication-1',
            auditType: 'SKILL_PUBLICATION',
            resourceId: 'enterprise-snapshot',
            resourceName: '上架申请',
            resourceBizType: 'SKILL',
            userId: 'publisher',
            applyStatus: 'PENDING',
          },
        ],
      });
      render(<ResourceAuditCenter resourceBizTypeList={['SKILL']} />);
      await screen.findByText('上架申请');
      expect(screen.getByRole('columnheader', { name: 'resource.auditApplicationType' })).toBeInTheDocument();
      expect(screen.getByText('resource.skillPublicationAudit')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: `resourceCenter.${action}` }));
      fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
      await waitFor(() =>
        expect(action === 'approve' ? approveUseApply : rejectUseApply).toHaveBeenCalledWith({
          resourceId: 'enterprise-snapshot',
          applyUserId: 'publisher',
          auditType: 'SKILL_PUBLICATION',
        })
      );
      expect(action === 'approve' ? rejectUseApply : approveUseApply).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByText('上架申请')).not.toBeInTheDocument());
    }
  );

  it.each(['DIG_EMPLOYEE', 'SKILL', 'KG_DOC', 'TOOL'])(
    'isolates pending, history and counts for %s',
    async (resourceType) => {
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
    }
  );

  it('keeps rejected requests visible when the approval endpoint fails and does not refresh counts', async () => {
    (rejectUseApply as jest.Mock).mockRejectedValueOnce(new Error('permission denied'));
    const onAuditComplete = jest.fn();
    render(<ResourceAuditCenter resourceBizTypeList={['SKILL']} onAuditComplete={onAuditComplete} />);
    await screen.findByText('待审核技能');
    fireEvent.click(screen.getByRole('button', { name: 'resourceCenter.reject' }));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    await screen.findByText('permission denied');
    expect(screen.getByText('待审核技能')).toBeInTheDocument();
    expect(onAuditComplete).not.toHaveBeenCalled();
  });

  it.each(['001', '017'])('hides application type in both lists for employee type %s', async (agentType) => {
    mockQueryResourceUseApplyAudit.mockImplementation(({ history }: { history: boolean }) =>
      Promise.resolve({
        data: [
          {
            resourceId: 'group-1',
            resourceName: '待审核员工组',
            resourceBizType: 'DIG_EMPLOYEE',
            agentType,
            privilegeGrantId: 'grant-group',
            userId: 'applicant',
            userName: '申请人',
            applyStatus: history ? 'X' : 'P',
            auditUserName: '审核人员',
            auditTime: '2026-10-08 10:00:00',
          },
        ],
      })
    );
    render(<ResourceAuditCenter resourceBizTypeList={['DIG_EMPLOYEE']} />);
    await screen.findByText('待审核员工组');
    expect(
      screen.getByText(agentType === '017' ? 'common.digitalEmployeeGroup' : 'common.digitalEmployee')
    ).toBeInTheDocument();
    // 员工和员工组的待审核、历史列表均不再重复显示固定的使用权限类型。
    expect(screen.queryByRole('columnheader', { name: 'resource.auditApplicationType' })).not.toBeInTheDocument();
    expect(screen.queryByText('resource.resourceUseAudit')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('resourceCenter.reviewHistory'));
    await screen.findByText('审核人员');
    expect(screen.queryByRole('columnheader', { name: 'resource.auditApplicationType' })).not.toBeInTheDocument();
    expect(screen.queryByText('resource.resourceUseAudit')).not.toBeInTheDocument();
    expect(screen.getByText('2026-10-08 10:00:00')).toBeInTheDocument();
    expect(screen.getByText('resource.useApplyApproveSuccess')).toBeInTheDocument();
  });
});
