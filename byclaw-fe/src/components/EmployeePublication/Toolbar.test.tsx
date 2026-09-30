import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { message } from 'antd';
import { history } from '@umijs/max';
import PublicationToolbar from './Toolbar';
import {
  publicationAction,
  previewPublication,
  getPublication,
  openOfficialEmployee,
  type PublicationDetail,
} from '@/service/employeePublication';

jest.mock('@umijs/max', () => ({ history: { push: jest.fn(), replace: jest.fn() } }));

jest.mock('@/service/employeePublication', () => ({
  publicationAction: jest.fn(),
  previewPublication: jest.fn(),
  downloadPublicationSkill: jest.fn(),
  getPublication: jest.fn(),
  openOfficialEmployee: jest.fn(),
  openEmployeePublication: jest.fn(),
  publicationUrl: (detail: PublicationDetail) => `/publication/${detail.publication.requestId}`,
  publicationStatus: { DRAFT: '草稿', PENDING: '待审核', PUBLISHED: '已发布' },
}));
const candidate: PublicationDetail = {
  publication: {
    requestId: '100',
    sourceId: '10',
    employeeName: '员工',
    authorName: '作者',
    status: 'DRAFT',
    revision: 3,
    updatedAt: '',
  },
  employee: {},
  dependencies: [],
  canEdit: true,
  canSubmit: true,
  canReview: false,
  canWithdraw: true,
};

async function continuePublication() {
  fireEvent.click(await screen.findByRole('button', { name: '确认并继续发布' }));
}

describe('employee publication controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (publicationAction as jest.Mock).mockReset();
    (previewPublication as jest.Mock)
      .mockReset()
      .mockImplementation(async (publication) => ({ ...candidate, publication }));
    jest.spyOn(message, 'success').mockImplementation(jest.fn());
    jest.spyOn(message, 'error').mockImplementation(jest.fn());
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows refreshed resource scope before publishing and returns to the saved configuration without submitting', async () => {
    const saved = { ...candidate, publication: { ...candidate.publication, revision: 4 } };
    const fresh = {
      ...saved,
      dependencies: [
        {
          resourceId: '21',
          name: '项目知识库',
          action: 'REFERENCE_RESOURCE',
          resourceType: 'KG_DOC',
          warning: '该资源为私有资源',
          reason: '该资源为私有资源',
          availabilityScope: '原有授权用户（私有资源）',
          impact: '未获授权的使用者无法使用该知识库',
        },
      ],
    };
    const onSave = jest.fn().mockResolvedValue(saved);
    const onChange = jest.fn();
    (previewPublication as jest.Mock).mockResolvedValue(fresh);
    render(<PublicationToolbar detail={candidate} dirty onChange={onChange} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '提交发布' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(previewPublication).toHaveBeenCalledWith(saved.publication);
    expect(dialog.getByText('知识')).toBeInTheDocument();
    expect(dialog.getByText('项目知识库')).toBeInTheDocument();
    expect(dialog.getByText('原有授权用户（私有资源）')).toBeInTheDocument();
    expect(dialog.getByText('该资源为私有资源')).toBeInTheDocument();
    expect(dialog.getByText('未获授权的使用者无法使用该知识库')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: '确认并继续发布' })).toBeEnabled();
    expect(publicationAction).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: '返回修改' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '提交发布' })).toBeEnabled());
    expect(publicationAction).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(fresh);
  });

  it('shows a preflight failure without submitting or opening confirmation', async () => {
    (previewPublication as jest.Mock).mockRejectedValue('申请已被修改，请刷新后再操作');
    render(<PublicationToolbar detail={candidate} dirty={false} onChange={jest.fn()} onSave={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '提交发布' }));
    await waitFor(() => expect(message.error).toHaveBeenCalledWith('申请已被修改，请刷新后再操作'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(publicationAction).not.toHaveBeenCalled();
  });

  it('groups the publication explanation with the actions and expands detailed rules on demand', async () => {
    render(<PublicationToolbar detail={candidate} dirty={false} onChange={jest.fn()} onSave={jest.fn()} />);
    const overview = within(screen.getByRole('region', { name: '发布操作与说明' }));
    expect(overview.getByRole('button', { name: '提交发布' })).toBeInTheDocument();
    expect(
      overview.getByText('本页编辑待发布版本。审核通过后创建或更新官方副本，原个人员工不变。')
    ).toBeInTheDocument();
    fireEvent.click(overview.getByRole('button', { name: '查看发布规则' }));
    expect(await screen.findByText('发布范围与规则')).toBeInTheDocument();
  });

  it.each(['submit', 'approve'])('resource warnings remain visible and do not block %s', async (action) => {
    const detail = {
      ...candidate,
      canSubmit: action === 'submit',
      canReview: action === 'approve',
      dependencies: [
        { resourceId: '*', name: '全部工具', action: 'BUILTIN_TOOL' },
        {
          resourceId: '20',
          name: '私有工具',
          action: 'REFERENCE_TOOL',
          resourceType: 'TOOL',
          warning: '部分使用者无权调用',
        },
        {
          resourceId: '21',
          name: '私有知识库',
          action: 'REFERENCE_RESOURCE',
          resourceType: 'KG_DOC',
          warning: '部分使用者无权使用',
        },
        {
          resourceId: '22',
          name: '失效技能',
          action: 'REFERENCE_RESOURCE',
          resourceType: 'SKILL',
          warning: '技能文件不存在',
        },
      ],
    };
    (previewPublication as jest.Mock).mockResolvedValue(detail);
    (publicationAction as jest.Mock).mockResolvedValue({
      ...detail,
      publication: { ...candidate.publication, status: 'PUBLISHED' },
    });
    render(<PublicationToolbar detail={detail} dirty={false} onChange={jest.fn()} onSave={jest.fn()} />);
    expect(screen.getByText('3 项使用范围受限')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '保留关联（4）' }));
    expect(screen.getByText('全部工具')).toBeInTheDocument();
    expect(screen.getByText('部分使用者无权使用')).toBeInTheDocument();
    expect(screen.getByText('技能文件不存在')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: action === 'submit' ? '提交发布' : '通过并发布' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('可以继续发布，有 3 项资源需要留意')).toBeInTheDocument();
    expect(dialog.getByText('私有知识库')).toBeInTheDocument();
    expect(dialog.queryByText('全部工具')).not.toBeInTheDocument();
    fireEvent.click(dialog.getByText('查看其余资源（1 项，无使用限制提醒）'));
    expect(await dialog.findByText('全部工具')).toBeInTheDocument();
    await continuePublication();
    await waitFor(() => expect(publicationAction).toHaveBeenCalledWith(action, detail.publication, { comment: '' }));
  });

  it('shows string errors returned by the request layer instead of the fallback', async () => {
    (publicationAction as jest.Mock).mockRejectedValue('请先登录当前企业');
    render(<PublicationToolbar detail={candidate} dirty={false} onChange={jest.fn()} onSave={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '提交发布' }));
    await continuePublication();
    await waitFor(() => expect(message.error).toHaveBeenCalledWith('请先登录当前企业'));
  });

  it('shows rejection details and only creates a draft after an explicit revision action', async () => {
    const rejected = {
      ...candidate,
      canEdit: false,
      canSubmit: false,
      canWithdraw: false,
      canRevise: true,
      publication: {
        ...candidate.publication,
        status: 'REJECTED',
        reviewerName: '平台审核员',
        reviewedAt: '2026-09-27 20:00:00',
        comment: '请完善岗位描述',
      },
    };
    const draft = { ...candidate, publication: { ...candidate.publication, requestId: '101' } };
    (publicationAction as jest.Mock).mockResolvedValue(draft);
    render(<PublicationToolbar detail={rejected} dirty={false} onSave={jest.fn()} onChange={jest.fn()} />);
    expect(screen.getByText('审核结果：已驳回')).toBeInTheDocument();
    expect(screen.getByText('审核人：平台审核员')).toBeInTheDocument();
    expect(screen.getByText('审核时间：2026-09-27 20:00')).toBeInTheDocument();
    expect(screen.getByText('驳回原因：请完善岗位描述')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存待发布配置' })).not.toBeInTheDocument();
    expect(publicationAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '修改并重新申请' }));
    await waitFor(() =>
      expect(publicationAction).toHaveBeenCalledWith('revise', rejected.publication, { comment: '' })
    );
    expect(history.replace).toHaveBeenCalledWith('/publication/101');
  });

  it('keeps the previous rejection visible while editing the new application', async () => {
    (getPublication as jest.Mock).mockResolvedValue(candidate);
    render(
      <PublicationToolbar
        detail={{
          ...candidate,
          previousReview: {
            requestId: '100',
            reviewerName: '审核员',
            reviewedAt: '2026-09-27 20:00:00',
            comment: '请完善岗位描述',
          },
        }}
        dirty={false}
        onSave={jest.fn()}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByText('上次审核意见')).toBeInTheDocument();
    expect(screen.getByText('驳回原因：请完善岗位描述')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存待发布配置' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '查看上次审核记录' }));
    await waitFor(() => expect(history.push).toHaveBeenCalledWith('/publication/100'));
  });

  it('does not offer a new draft from an obsolete rejection', () => {
    render(
      <PublicationToolbar
        detail={{
          ...candidate,
          canEdit: false,
          canSubmit: false,
          canRevise: false,
          publication: { ...candidate.publication, status: 'REJECTED' },
        }}
        dirty={false}
        onSave={jest.fn()}
        onChange={jest.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: '修改并重新申请' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看最新申请' })).toBeEnabled();
  });

  it('keeps unsaved edits on the page when previous review details are requested', () => {
    render(
      <PublicationToolbar
        detail={{ ...candidate, previousReview: { requestId: '99', comment: '完善描述' } }}
        dirty
        onSave={jest.fn()}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByText('驳回原因：完善描述')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看上次审核记录' })).toBeDisabled();
  });

  it('provides a read-only official-copy entry after publication', () => {
    render(
      <PublicationToolbar
        detail={{
          ...candidate,
          canEdit: false,
          canSubmit: false,
          publication: { ...candidate.publication, status: 'PUBLISHED', officialId: '90' },
        }}
        dirty={false}
        onSave={jest.fn()}
        onChange={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '查看官方副本' }));
    expect(openOfficialEmployee).toHaveBeenCalledWith('90');
  });

  it('offers saving in the publication toolbar and allows automatic saving on submission', () => {
    render(<PublicationToolbar detail={candidate} dirty onChange={jest.fn()} onSave={jest.fn()} />);
    expect(screen.getByRole('button', { name: '保存待发布配置' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '提交发布' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '通过并发布' })).not.toBeInTheDocument();
  });
  it('blocks submission for employee configuration errors', () => {
    render(
      <PublicationToolbar
        detail={{
          ...candidate,
          dependencies: [{ resourceId: '', name: '员工名称', action: 'BLOCKED', error: '员工名称必填' }],
        }}
        dirty={false}
        onChange={jest.fn()}
        onSave={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: '提交发布' })).toBeDisabled();
    expect(screen.getByText(/员工名称必填/)).toBeInTheDocument();
  });
  it('explains adminvip-only review and gives platform submitters no approval or pending edit controls', () => {
    render(
      <PublicationToolbar
        detail={{
          ...candidate,
          publication: { ...candidate.publication, status: 'PENDING', requiresAdminVipReview: true },
          canEdit: false,
          canSubmit: false,
          canReview: false,
        }}
        dirty={false}
        onChange={jest.fn()}
        onSave={jest.fn()}
      />
    );
    expect(screen.getByText('仅超管 adminvip 可审核')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通过并发布' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '驳回' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存待发布配置' })).not.toBeInTheDocument();
  });
  it('submits the reviewed revision and shows the returned state', async () => {
    const next = { ...candidate, publication: { ...candidate.publication, status: 'PENDING', revision: 4 } };
    (publicationAction as jest.Mock).mockResolvedValue(next);
    const onChange = jest.fn();
    const onSave = jest.fn();
    render(<PublicationToolbar detail={candidate} dirty={false} onChange={onChange} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '提交发布' }));
    await continuePublication();
    await waitFor(() =>
      expect(publicationAction).toHaveBeenCalledWith('submit', candidate.publication, { comment: '' })
    );
    expect(onChange).toHaveBeenCalledWith(next);
    expect(onSave).not.toHaveBeenCalled();
  });
  it('lets the reviewer open a rejection dialog requiring a reason', () => {
    render(
      <PublicationToolbar
        detail={{ ...candidate, canReview: true, canSubmit: false }}
        dirty={false}
        onChange={jest.fn()}
        onSave={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: '通过并发布' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /驳\s*回/ }));
    expect(screen.getByPlaceholderText('请填写驳回原因')).toBeInTheDocument();
  });

  it('saves a candidate without submitting it', async () => {
    const saved = { ...candidate, publication: { ...candidate.publication, revision: 4 } };
    const onSave = jest.fn().mockResolvedValue(saved);
    const onChange = jest.fn();
    render(<PublicationToolbar detail={candidate} dirty onSave={onSave} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '保存待发布配置' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
    expect(publicationAction).not.toHaveBeenCalled();
    expect(message.success).toHaveBeenCalledWith('待发布配置已保存');
  });

  it.each(['submit', 'approve'] as const)('waits for saving and uses the new revision for %s', async (action) => {
    const editable = {
      ...candidate,
      publication: { ...candidate.publication, status: action === 'approve' ? 'PENDING' : 'DRAFT' },
      canSubmit: action === 'submit',
      canReview: action === 'approve',
    };
    const saved = { ...editable, publication: { ...editable.publication, revision: 4 } };
    const next = { ...saved, publication: { ...saved.publication, status: 'PUBLISHED', revision: 5 } };
    let finishSave!: (value: PublicationDetail) => void;
    const onSave = jest.fn(
      () =>
        new Promise<PublicationDetail>((resolve) => {
          finishSave = resolve;
        })
    );
    const onChange = jest.fn();
    const onBusyChange = jest.fn();
    (publicationAction as jest.Mock).mockResolvedValue(next);
    render(
      <PublicationToolbar detail={editable} dirty onSave={onSave} onChange={onChange} onBusyChange={onBusyChange} />
    );
    const button = screen.getByRole('button', { name: action === 'submit' ? '提交发布' : '通过并发布' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(publicationAction).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存待发布配置' })).toBeDisabled();
    expect(onBusyChange).toHaveBeenCalledWith(true);
    await act(async () => finishSave(saved));
    await continuePublication();
    await waitFor(() => expect(publicationAction).toHaveBeenCalledWith(action, saved.publication, { comment: '' }));
    expect(publicationAction).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenNthCalledWith(1, saved);
    expect(onChange).toHaveBeenLastCalledWith(next);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('does not submit when form validation prevents saving', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<PublicationToolbar detail={candidate} dirty onSave={onSave} onChange={jest.fn()} />);
    const submit = screen.getByRole('button', { name: '提交发布' });
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeEnabled());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(publicationAction).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
  });

  it('does not approve when saving fails', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('申请已被修改，请刷新后再操作'));
    render(
      <PublicationToolbar
        detail={{ ...candidate, canSubmit: false, canReview: true }}
        dirty
        onSave={onSave}
        onChange={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '通过并发布' }));
    await waitFor(() => expect(message.error).toHaveBeenCalledWith('申请已被修改，请刷新后再操作'));
    expect(publicationAction).not.toHaveBeenCalled();
  });

  it('saves corrected dependencies before checking whether submission is allowed', async () => {
    const saved = { ...candidate, publication: { ...candidate.publication, revision: 4 } };
    const onSave = jest.fn().mockResolvedValue(saved);
    (publicationAction as jest.Mock).mockResolvedValue(saved);
    render(
      <PublicationToolbar
        detail={{
          ...candidate,
          dependencies: [{ resourceId: '', name: '员工名称', action: 'BLOCKED', error: '员工名称必填' }],
        }}
        dirty
        onSave={onSave}
        onChange={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '提交发布' }));
    await continuePublication();
    await waitFor(() => expect(publicationAction).toHaveBeenCalledWith('submit', saved.publication, { comment: '' }));
  });

  it('stops after saving if the updated dependencies still block publication', async () => {
    const saved = {
      ...candidate,
      publication: { ...candidate.publication, revision: 4 },
      dependencies: [{ resourceId: '', name: '员工名称', action: 'BLOCKED', error: '员工名称必填' }],
    };
    const onChange = jest.fn();
    render(
      <PublicationToolbar detail={candidate} dirty onSave={jest.fn().mockResolvedValue(saved)} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole('button', { name: '提交发布' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
    expect(publicationAction).not.toHaveBeenCalled();
    expect(message.error).toHaveBeenCalledWith('待发布配置尚未满足发布条件，请处理页面提示后再提交');
  });

  it('keeps the saved revision when submission subsequently fails', async () => {
    const saved = { ...candidate, publication: { ...candidate.publication, revision: 4 } };
    const onChange = jest.fn();
    (publicationAction as jest.Mock).mockRejectedValue(new Error('提交失败'));
    render(
      <PublicationToolbar detail={candidate} dirty onSave={jest.fn().mockResolvedValue(saved)} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole('button', { name: '提交发布' }));
    await continuePublication();
    await waitFor(() => expect(message.error).toHaveBeenCalledWith('提交失败'));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledWith(saved);
  });

  it('retries a failed publication without saving its read-only candidate', async () => {
    const failed = {
      ...candidate,
      publication: { ...candidate.publication, status: 'FAILED' },
      canEdit: false,
      canSubmit: false,
      canReview: true,
    };
    const onSave = jest.fn();
    (publicationAction as jest.Mock).mockResolvedValue(failed);
    render(<PublicationToolbar detail={failed} dirty={false} onSave={onSave} onChange={jest.fn()} />);
    expect(screen.queryByRole('button', { name: '保存待发布配置' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试发布' }));
    await continuePublication();
    await waitFor(() => expect(publicationAction).toHaveBeenCalledWith('approve', failed.publication, { comment: '' }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
