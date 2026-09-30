import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { message } from 'antd';
import useEmployeePublicationCapabilities from '@/hooks/useEmployeePublicationCapabilities';
import {
  getPublication,
  previewPublication,
  listPublications,
  publicationAction,
  publicationUrl,
  type Publication,
} from '@/service/employeePublication';
import PublicationAuditList from './AuditList';

jest.mock('@/hooks/useEmployeePublicationCapabilities');
const mockNavigate = jest.fn();
jest.mock('@umijs/max', () => ({ useNavigate: () => mockNavigate }));
jest.mock('@/service/employeePublication', () => ({
  getPublication: jest.fn(),
  previewPublication: jest.fn(),
  publicationUrl: jest.fn(),
  listPublications: jest.fn(),
  publicationAction: jest.fn(),
  publicationStatus: {
    PENDING: '待审核',
    PUBLISHED: '已发布',
    DRAFT: '草稿',
    FAILED: '发布失败',
    REJECTED: '已驳回',
    WITHDRAWN: '已撤回',
  },
}));

const pending: Publication = {
  requestId: '100',
  sourceId: '10',
  employeeName: '待发布员工',
  authorName: '作者',
  status: 'PENDING',
  revision: 3,
  updatedAt: '2026-09-27 19:00:00',
  canReview: true,
};

describe('publication approval in the audit list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (previewPublication as jest.Mock)
      .mockReset()
      .mockResolvedValue({ publication: pending, employee: { resourceId: '10' }, dependencies: [], canReview: true });
    (useEmployeePublicationCapabilities as jest.Mock).mockReturnValue({ enabled: true, administrator: true });
    (listPublications as jest.Mock).mockResolvedValue({ list: [pending], total: 1 });
    jest.spyOn(message, 'success').mockImplementation(jest.fn());
    jest.spyOn(message, 'error').mockImplementation(jest.fn());
  });
  afterEach(() => jest.restoreAllMocks());

  it('identifies adminvip-only applications without offering platform approval', async () => {
    (listPublications as jest.Mock).mockResolvedValue({
      list: [{ ...pending, requiresAdminVipReview: true, canReview: false }],
      total: 1,
    });
    render(<PublicationAuditList />);
    expect(await screen.findByText('等待超管 adminvip 审核')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通过并发布' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看详情' })).toBeEnabled();
  });

  it.each([undefined, { enabled: false, administrator: true }])(
    'does not load publication records when disabled or unconfirmed',
    (capabilities) => {
      (useEmployeePublicationCapabilities as jest.Mock).mockReturnValue(capabilities);
      render(<PublicationAuditList />);
      expect(listPublications).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: '通过并发布' })).not.toBeInTheDocument();
    }
  );

  it('shows resource restrictions before approval and can return to editing without approving', async () => {
    const fresh = {
      publication: pending,
      employee: { resourceId: '10' },
      dependencies: [
        {
          resourceId: '22',
          name: '原始个人技能',
          action: 'REFERENCE_RESOURCE',
          resourceType: 'SKILL',
          warning: '无法生成技能副本',
          reason: '无法生成技能副本',
          availabilityScope: '原有授权用户',
          impact: '保留原技能，未获授权的用户无法使用',
        },
      ],
    };
    (previewPublication as jest.Mock).mockResolvedValue(fresh);
    (publicationUrl as jest.Mock).mockReturnValue('/digitalEmployeesCreate?publicationId=100');
    render(<PublicationAuditList />);
    fireEvent.click(await screen.findByRole('button', { name: '通过并发布' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(previewPublication).toHaveBeenCalledWith(pending);
    expect(dialog.getByText('原始个人技能')).toBeInTheDocument();
    expect(dialog.getByText('原有授权用户')).toBeInTheDocument();
    expect(dialog.getByText('无法生成技能副本')).toBeInTheDocument();
    expect(dialog.getByText('保留原技能，未获授权的用户无法使用')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: '确认并继续发布' })).toBeEnabled();
    fireEvent.click(dialog.getByRole('button', { name: '返回修改' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/digitalEmployeesCreate?publicationId=100'));
    expect(publicationAction).not.toHaveBeenCalled();
  });

  it('does not approve a stale revision rejected by preview', async () => {
    (previewPublication as jest.Mock).mockRejectedValue('申请已被修改，请刷新后再操作');
    render(<PublicationAuditList />);
    fireEvent.click(await screen.findByRole('button', { name: '通过并发布' }));
    await waitFor(() => expect(message.error).toHaveBeenCalledWith('申请已被修改，请刷新后再操作'));
    expect(publicationAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(listPublications).toHaveBeenCalledTimes(2);
  });

  it('publishes with tool warnings and directs reviewers to the detailed reminder', async () => {
    const warning = jest.spyOn(message, 'warning').mockImplementation(jest.fn());
    (publicationAction as jest.Mock).mockResolvedValue({
      publication: { ...pending, status: 'PUBLISHED' },
      dependencies: [{ resourceId: '20', name: '私有工具', action: 'REFERENCE_TOOL', warning: '部分工具可能不可用' }],
    });
    render(<PublicationAuditList />);
    fireEvent.click(await screen.findByRole('button', { name: '通过并发布' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认并继续发布' }));
    await waitFor(() => expect(warning).toHaveBeenCalledWith('部分关联资源可能不可用，请进入申请详情查看可用性提醒'));
    expect(message.error).not.toHaveBeenCalled();
  });

  it('approves the displayed revision and refreshes the row after publishing', async () => {
    const published = { ...pending, status: 'PUBLISHED', revision: 5, canReview: false };
    (publicationAction as jest.Mock).mockResolvedValue({ publication: published, dependencies: [] });
    render(<PublicationAuditList />);
    fireEvent.click(await screen.findByRole('button', { name: '通过并发布' }));
    expect(publicationAction).not.toHaveBeenCalled();
    (listPublications as jest.Mock).mockResolvedValue({ list: [published], total: 1 });
    fireEvent.click(await screen.findByRole('button', { name: '确认并继续发布' }));
    await waitFor(() => expect(publicationAction).toHaveBeenCalledWith('approve', pending));
    await screen.findByText('已发布');
    expect(screen.queryByRole('button', { name: '通过并发布' })).not.toBeInTheDocument();
    expect(message.success).toHaveBeenCalledWith('审核通过，已发布到官方推荐');
    expect(listPublications).toHaveBeenCalledTimes(2);
  });

  it('does not offer approval to ordinary users', async () => {
    (useEmployeePublicationCapabilities as jest.Mock).mockReturnValue({ enabled: true, administrator: false });
    render(<PublicationAuditList />);
    await screen.findByText('待发布员工');
    expect(screen.queryByRole('button', { name: '通过并发布' })).not.toBeInTheDocument();
  });

  it('honors row permissions for drafts and adminvip-protected employees', async () => {
    (listPublications as jest.Mock).mockResolvedValue({
      list: [
        { ...pending, status: 'DRAFT', canReview: false },
        { ...pending, requestId: '101', employeeName: '受保护员工', canReview: false },
        { ...pending, requestId: '102', employeeName: '失败员工', status: 'FAILED' },
      ],
      total: 3,
    });
    render(<PublicationAuditList />);
    expect(await screen.findByRole('button', { name: '重试发布' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '通过并发布' })).not.toBeInTheDocument();
  });

  it('shows a failed publication without reporting success and refreshes for retry', async () => {
    const failed = { ...pending, status: 'FAILED', publishError: '运行配置同步失败', revision: 5 };
    (publicationAction as jest.Mock).mockResolvedValue({ publication: failed });
    render(<PublicationAuditList />);
    fireEvent.click(await screen.findByRole('button', { name: '通过并发布' }));
    (listPublications as jest.Mock).mockResolvedValue({ list: [failed], total: 1 });
    const confirm = await screen.findByRole('button', { name: '确认并继续发布' });
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(listPublications).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: '重试发布' }, { timeout: 5000 })).toBeInTheDocument();
    expect(message.error).toHaveBeenCalledWith('运行配置同步失败');
    expect(message.success).not.toHaveBeenCalled();
  });

  it('refreshes a stale request after the server rejects its revision', async () => {
    (publicationAction as jest.Mock).mockRejectedValue(new Error('申请已被修改，请刷新后再操作'));
    render(<PublicationAuditList />);
    fireEvent.click(await screen.findByRole('button', { name: '通过并发布' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认并继续发布' }));
    await waitFor(() => expect(listPublications).toHaveBeenCalledTimes(2));
    expect(message.error).toHaveBeenCalledWith('申请已被修改，请刷新后再操作');
    expect(message.success).not.toHaveBeenCalled();
  });

  it('groups the employee and reviewer information and retains both feedback and failure reasons', async () => {
    (listPublications as jest.Mock).mockResolvedValue({
      list: [
        {
          ...pending,
          status: 'FAILED',
          reviewerName: '审核管理员',
          reviewedAt: '2026-09-27 18:30:00',
          comment: '已补全说明，可以发布。',
          publishError: '资源同步失败，请检查技能文件。',
        },
      ],
      total: 41,
    });
    render(<PublicationAuditList />);
    await screen.findByText('共 41 条申请');
    const row = screen.getByRole('row', { name: /待发布员工/ });
    expect(within(row).getByText('创建者：作者')).toBeInTheDocument();
    expect(within(row).getByText('审核人：审核管理员')).toBeInTheDocument();
    expect(within(row).getByText('审核于 2026-09-27 18:30')).toBeInTheDocument();
    expect(within(row).getByText('2026-09-27 19:00')).toBeInTheDocument();
    expect(within(row).getByText('已补全说明，可以发布。')).toBeInTheDocument();
    expect(within(row).getByText('资源同步失败，请检查技能文件。')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => expect(listPublications).toHaveBeenLastCalledWith(false, 2));
  });

  it('offers result viewing for rejected requests without creating or submitting a new request', async () => {
    const rejected = { ...pending, status: 'REJECTED', comment: '请补充使用说明', canReview: false, updatedAt: '' };
    (listPublications as jest.Mock).mockResolvedValue({ list: [rejected], total: 1 });
    const detail = { publication: rejected, employee: { resourceId: '10' } };
    (getPublication as jest.Mock).mockResolvedValue(detail);
    (publicationUrl as jest.Mock).mockReturnValue('/digitalEmployeesCreate?publicationId=100');
    render(<PublicationAuditList />);
    fireEvent.click(await screen.findByRole('button', { name: '查看结果' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/digitalEmployeesCreate?publicationId=100'));
    expect(getPublication).toHaveBeenCalledWith('100');
    expect(publicationAction).not.toHaveBeenCalled();
    expect(screen.getByText('请补充使用说明')).toBeInTheDocument();
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('explains an empty list and does not show reviewer scope to ordinary users', async () => {
    (useEmployeePublicationCapabilities as jest.Mock).mockReturnValue({ enabled: true, administrator: false });
    (listPublications as jest.Mock).mockResolvedValue({ list: [], total: 0 });
    render(<PublicationAuditList />);
    await screen.findByText('你还没有发布申请，可从个人员工卡片发起发布');
    expect(screen.queryByText('发布审核及记录')).not.toBeInTheDocument();
    expect(screen.getByText('共 0 条申请')).toBeInTheDocument();
  });

  it('distinguishes loading failure from an empty list and allows retry', async () => {
    (listPublications as jest.Mock).mockRejectedValueOnce(new Error('服务暂时不可用'));
    render(<PublicationAuditList />);
    await screen.findByText('发布申请加载失败');
    expect(screen.getByText('服务暂时不可用')).toBeInTheDocument();
    expect(screen.queryByText('共 0 条申请')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await screen.findByText('待发布员工');
    expect(screen.queryByText('发布申请加载失败')).not.toBeInTheDocument();
  });

  it('ignores late results from the previous scope when switching between mine and review', async () => {
    let resolveMine!: (value: { list: Publication[]; total: number }) => void;
    (listPublications as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMine = resolve;
      })
    );
    (listPublications as jest.Mock).mockResolvedValue({
      list: [{ ...pending, requestId: '200', employeeName: '审核列表员工' }],
      total: 1,
    });
    render(<PublicationAuditList />);
    fireEvent.click(screen.getByText('发布审核及记录'));
    await screen.findByText('审核列表员工');
    await act(async () => {
      resolveMine({ list: [pending], total: 99 });
    });
    expect(screen.getByText('审核列表员工')).toBeInTheDocument();
    expect(screen.queryByText('待发布员工')).not.toBeInTheDocument();
    expect(screen.queryByText('共 99 条申请')).not.toBeInTheDocument();
    expect(listPublications).toHaveBeenLastCalledWith(true, 1);
  });
});
