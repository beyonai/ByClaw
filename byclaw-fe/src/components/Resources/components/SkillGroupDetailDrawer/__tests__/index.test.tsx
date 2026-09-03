jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

const mockGetSkillGroupDetail = jest.fn();
const mockPreflightInstallSkillGroup = jest.fn();
const mockExecuteInstallSkillGroup = jest.fn();
const mockPreflightUninstallSkillGroup = jest.fn();
const mockUninstallSkillGroup = jest.fn();
const mockRefreshSkillGroupDetail = jest.fn();
const mockEmit = jest.fn();

jest.mock('@/pages/manager/service/resources', () => ({
  getSkillGroupDetail: (...args: any[]) => mockGetSkillGroupDetail(...args),
  preflightInstallSkillGroup: (...args: any[]) => mockPreflightInstallSkillGroup(...args),
  executeInstallSkillGroup: (...args: any[]) => mockExecuteInstallSkillGroup(...args),
  preflightUninstallSkillGroup: (...args: any[]) => mockPreflightUninstallSkillGroup(...args),
  uninstallSkillGroup: (...args: any[]) => mockUninstallSkillGroup(...args),
  refreshSkillGroupDetail: (...args: any[]) => mockRefreshSkillGroupDetail(...args),
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: { emit: mockEmit } }),
}));

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import SkillGroupDetailDrawer from '..';
import type { IMessage } from '@/typescript/message';

const detail = {
  resourceId: '101',
  resourceName: '产品经理一站搭子',
  resourceDesc: '帮助产品经理完成日常工作的技能集合。',
  avatar: 'https://example.com/poster.png',
  createBy: '张三',
  catalogName: '产品设计',
  members: [
    { resourceId: '1', resourceName: 'brainstorming', resourceDesc: '提出创意' },
    { resourceId: '2', resourceName: 'user-research', resourceDesc: '分析用户' },
  ],
};

describe('SkillGroupDetailDrawer', () => {
  beforeEach(() => {
    mockGetSkillGroupDetail.mockReset();
    mockPreflightInstallSkillGroup.mockReset();
    mockExecuteInstallSkillGroup.mockReset();
    mockPreflightUninstallSkillGroup.mockReset();
    mockUninstallSkillGroup.mockReset();
    mockRefreshSkillGroupDetail.mockReset();
    mockRefreshSkillGroupDetail.mockResolvedValue({ data: { ...detail, installedByGroup: false } });
    mockPreflightUninstallSkillGroup.mockResolvedValue({
      installedByGroup: true,
      previewToken: 'preview-token',
      exclusiveSkills: [],
      sharedSkills: [],
      affectedCount: 0,
    });
    mockEmit.mockReset();
  });

  it('renders loading, then the poster and all detail fields with member skills', async () => {
    let resolveDetail!: (value: unknown) => void;
    mockGetSkillGroupDetail.mockReturnValue(
      new Promise((resolve) => {
        resolveDetail = resolve;
      })
    );

    render(
      <SkillGroupDetailDrawer
        groupId="101"
        digitalEmployeeId="201"
        onClose={jest.fn()}
        onUpdateMessage={(payload: Partial<IMessage> & { messageId: string }) => payload.messageId}
        onCreateMessage={(payload: Partial<IMessage> & { messageId: string }) => payload.messageId}
      />
    );
    expect(screen.getByTestId('skill-group-detail-loading')).toBeInTheDocument();

    resolveDetail({ data: detail });

    expect(await screen.findByRole('img', { name: '产品经理一站搭子' })).toHaveAttribute('src', detail.avatar);
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('产品设计')).toBeInTheDocument();
    expect(screen.getByText(detail.resourceDesc)).toBeInTheDocument();
    expect(screen.getByText('brainstorming')).toBeInTheDocument();
    expect(screen.getByText('user-research')).toBeInTheDocument();
    expect(mockGetSkillGroupDetail).toHaveBeenCalledWith({ groupId: '101', digitalEmployeeId: '201' });
  });

  it('renders current member statuses and disables installation when every member is installed', async () => {
    mockGetSkillGroupDetail.mockResolvedValue({
      data: {
        ...detail,
        installedByGroup: true,
        members: detail.members.map((member) => ({ ...member, memberStatus: 'INSTALLED' })),
      },
    });

    render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" onClose={jest.fn()} />);

    expect(await screen.findAllByText('resource.skillGroup.memberStatus.installed')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'resource.skillGroup.installed' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: 'resource.skillGroup.uninstall' })).toBeInTheDocument();
  });

  it('keeps install enabled when skills are installed without this group source', async () => {
    mockGetSkillGroupDetail.mockResolvedValue({
      data: {
        ...detail,
        installedByGroup: false,
        members: detail.members.map((member) => ({ ...member, memberStatus: 'INSTALLED' })),
      },
    });

    render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" />);

    expect(await screen.findByRole('button', { name: 'resource.installSkillGroup' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'resource.skillGroup.uninstall' })).not.toBeInTheDocument();
  });

  it('shows shared sources and executes the selected force uninstall mode', async () => {
    const installedDetail = {
      ...detail,
      installedByGroup: true,
      members: detail.members.map((member) => ({ ...member, memberStatus: 'INSTALLED' })),
    };
    mockGetSkillGroupDetail.mockResolvedValue({ data: installedDetail });
    mockPreflightUninstallSkillGroup.mockResolvedValue({
      installedByGroup: true,
      previewToken: 'preview-token',
      exclusiveSkills: [],
      sharedSkills: [
        {
          resourceId: '1',
          resourceName: 'brainstorming',
          manualSource: true,
          otherGroupIds: ['202'],
          otherGroupNames: ['渠道智采'],
        },
      ],
      affectedCount: 1,
    });
    mockUninstallSkillGroup.mockResolvedValue({ removedSkillIds: ['1'], retainedSkillIds: [] });

    render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" />);
    const uninstallButton = await screen.findByRole('button', { name: 'resource.skillGroup.uninstall' });
    await waitFor(() => expect(uninstallButton).toBeEnabled());
    fireEvent.click(uninstallButton);
    expect(await screen.findByText('resource.skillGroup.uninstallSharedDescription')).toBeInTheDocument();
    expect(screen.getByText('resource.skillGroup.manualSource', { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId('uninstall-preserve-tooltip-icon')).toBeInTheDocument();
    expect(screen.getByTestId('uninstall-all-tooltip-icon')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'resource.skillGroup.uninstallAll' }));
    await waitFor(() =>
      expect(mockUninstallSkillGroup).toHaveBeenCalledWith({
        groupId: '101',
        digitalEmployeeId: '201',
        mode: 'REMOVE_ALL',
        previewToken: 'preview-token',
      })
    );
  });

  it('uses lightweight confirmation and preserves shared sources when the preview is exclusive-only', async () => {
    mockGetSkillGroupDetail.mockResolvedValue({
      data: {
        ...detail,
        installedByGroup: true,
        members: detail.members.map((member) => ({ ...member, memberStatus: 'INSTALLED' })),
      },
    });
    mockPreflightUninstallSkillGroup.mockResolvedValue({
      installedByGroup: true,
      previewToken: 'preview-token',
      exclusiveSkills: [{ resourceId: '1', manualSource: false, otherGroupIds: [], otherGroupNames: [] }],
      sharedSkills: [],
      affectedCount: 1,
    });
    mockUninstallSkillGroup.mockResolvedValue({ removedSkillIds: ['1'], retainedSkillIds: [] });

    render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" />);
    const uninstallButton = await screen.findByRole('button', { name: 'resource.skillGroup.uninstall' });
    await waitFor(() => expect(uninstallButton).toBeEnabled());
    fireEvent.click(uninstallButton);
    expect(await screen.findByText('resource.skillGroup.uninstallSimpleConfirm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    await waitFor(() =>
      expect(mockUninstallSkillGroup).toHaveBeenCalledWith({
        groupId: '101',
        digitalEmployeeId: '201',
        mode: 'PRESERVE_SHARED',
        previewToken: undefined,
      })
    );
  });

  it('does not report a completed uninstall as failed when only the detail refresh fails', async () => {
    mockGetSkillGroupDetail.mockResolvedValue({
      data: {
        ...detail,
        installedByGroup: true,
        members: detail.members.map((member) => ({ ...member, memberStatus: 'INSTALLED' })),
      },
    });
    mockUninstallSkillGroup.mockResolvedValue({
      removedSkillIds: ['1'],
      retainedSkillIds: [],
      summary: { members: detail.members.map((member) => ({ ...member, memberStatus: 'INSTALLABLE' })) },
    });
    mockRefreshSkillGroupDetail.mockRejectedValue(new Error('refresh failed'));

    render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" />);
    fireEvent.click(await screen.findByRole('button', { name: 'resource.skillGroup.uninstall' }));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));

    await waitFor(() => expect(mockRefreshSkillGroupDetail).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'resource.skillGroup.uninstall' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'resource.installSkillGroup' })).toBeEnabled();
  });

  it('keeps the force modal open with the latest preview when the confirmation token expires', async () => {
    mockGetSkillGroupDetail.mockResolvedValue({
      data: {
        ...detail,
        installedByGroup: true,
        members: detail.members.map((member) => ({ ...member, memberStatus: 'INSTALLED' })),
      },
    });
    mockPreflightUninstallSkillGroup.mockResolvedValue({
      installedByGroup: true,
      previewToken: 'old-token',
      exclusiveSkills: [],
      sharedSkills: [
        { resourceId: '1', resourceName: 'brainstorming', manualSource: true, otherGroupIds: [], otherGroupNames: [] },
      ],
      affectedCount: 1,
    });
    mockUninstallSkillGroup.mockResolvedValue({
      confirmationRequired: true,
      uninstallPreview: {
        installedByGroup: true,
        previewToken: 'new-token',
        exclusiveSkills: [],
        sharedSkills: [
          {
            resourceId: '2',
            resourceName: 'user-research',
            manualSource: true,
            otherGroupIds: [],
            otherGroupNames: [],
          },
        ],
        affectedCount: 1,
      },
    });

    render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" />);
    fireEvent.click(await screen.findByRole('button', { name: 'resource.skillGroup.uninstall' }));
    fireEvent.click(await screen.findByRole('button', { name: 'resource.skillGroup.uninstallAll' }));

    expect(await screen.findByText('user-research', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('resource.skillGroup.uninstallSharedDescription')).toBeInTheDocument();
    expect(mockRefreshSkillGroupDetail).not.toHaveBeenCalled();
  });

  it('renders an empty state for a missing detail and an error state for a failed request', async () => {
    mockGetSkillGroupDetail.mockResolvedValueOnce({ data: null });
    const { rerender } = render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" onClose={jest.fn()} />);
    expect(await screen.findByTestId('skill-group-detail-empty')).toBeInTheDocument();

    mockGetSkillGroupDetail.mockRejectedValueOnce(new Error('network error'));
    rerender(<SkillGroupDetailDrawer groupId="102" digitalEmployeeId="201" onClose={jest.fn()} />);
    expect(await screen.findByTestId('skill-group-detail-error')).toBeInTheDocument();
  });

  it('shows the generated default cover when the group does not provide a poster', async () => {
    mockGetSkillGroupDetail.mockResolvedValue({ data: { ...detail, avatar: '' } });

    render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" onClose={jest.fn()} />);

    expect(await screen.findByTestId('skill-group-detail-default-cover')).toHaveAttribute(
      'src',
      '/assets/skill-groups/default-skill-group-cover-1x1.png'
    );
  });

  it('displays the normalized 3:4 poster without cropping it', () => {
    const drawerStyles = readFileSync(resolve(__dirname, '../index.module.less'), 'utf8');

    expect(drawerStyles).toMatch(/object-fit:\s*contain/);
    expect(drawerStyles).not.toMatch(/object-fit:\s*cover/);
  });

  it('installs immediately when every remaining member is installable and refreshes the detail status', async () => {
    mockGetSkillGroupDetail.mockResolvedValue({ data: detail });
    mockPreflightInstallSkillGroup.mockResolvedValue({
      members: detail.members.map((member) => ({ ...member, memberStatus: 'INSTALLABLE' })),
      installed: 0,
      installable: 2,
      applyRequired: 0,
      applyPending: 0,
      unavailable: 0,
      total: 2,
      hasPermissionBarrier: false,
    });
    mockExecuteInstallSkillGroup.mockResolvedValue({
      installedSkillIds: ['1', '2'],
      existingSkillIds: ['3'],
      summary: {
        members: detail.members.map((member) => ({ ...member, memberStatus: 'INSTALLED' })),
        installed: 2,
        installable: 0,
        applyRequired: 0,
        applyPending: 0,
        unavailable: 0,
      },
    });
    const onClose = jest.fn();
    const events: CustomEvent[] = [];
    const handleInstalled = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('digitalEmployeeResourceInstalled', handleInstalled);

    const { rerender } = render(<SkillGroupDetailDrawer groupId="101" onClose={onClose} />);
    expect(await screen.findByRole('button', { name: 'resource.installSkillGroup' })).toBeDisabled();

    rerender(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" onClose={onClose} />);
    await screen.findByText('brainstorming');
    fireEvent.click(screen.getByRole('button', { name: 'resource.installSkillGroup' }));

    await waitFor(() =>
      expect(mockPreflightInstallSkillGroup).toHaveBeenCalledWith({ groupId: '101', digitalEmployeeId: '201' })
    );
    expect(mockExecuteInstallSkillGroup).toHaveBeenCalledWith({ groupId: '101', digitalEmployeeId: '201' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockEmit).toHaveBeenCalledWith('beyond-resourceList-resourceType-reload', {
      resourceType: 'SKILL',
      resetSkillFilters: false,
    });
    expect(events.map((event) => event.detail)).toEqual([
      { resourceId: '1' },
      { resourceId: '2' },
      { resourceId: '3' },
    ]);
    expect(onClose).not.toHaveBeenCalled();
    window.removeEventListener('digitalEmployeeResourceInstalled', handleInstalled);
  });

  it('shows categorized permission barriers and executes install plus applications only after confirmation', async () => {
    const mixedMembers = [
      { ...detail.members[0], memberStatus: 'INSTALLABLE' },
      { ...detail.members[1], resourceId: '2', resourceName: 'grill-me', memberStatus: 'APPLY_REQUIRED' },
      { resourceId: '3', resourceName: 'blocked-skill', memberStatus: 'APPLY_UNAVAILABLE' },
    ];
    mockGetSkillGroupDetail.mockResolvedValue({ data: { ...detail, members: mixedMembers } });
    mockPreflightInstallSkillGroup.mockResolvedValue({
      members: mixedMembers,
      installed: 0,
      installable: 1,
      applyRequired: 1,
      applyPending: 0,
      unavailable: 1,
      total: 3,
      hasPermissionBarrier: true,
    });
    mockExecuteInstallSkillGroup.mockResolvedValue({
      installedSkillIds: ['1'],
      existingSkillIds: [],
      appliedSkillIds: ['2'],
      pendingSkillIds: [],
      unavailableSkillIds: ['3'],
      summary: {
        members: mixedMembers.map((member) => ({
          ...member,
          memberStatus:
            member.resourceId === '1' ? 'INSTALLED' : member.resourceId === '2' ? 'APPLY_PENDING' : 'APPLY_UNAVAILABLE',
        })),
        installed: 1,
        installable: 0,
        applyRequired: 0,
        applyPending: 1,
        unavailable: 1,
      },
    });

    render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" onClose={jest.fn()} />);
    await screen.findByText('grill-me');
    fireEvent.click(screen.getByRole('button', { name: 'resource.installSkillGroup' }));

    expect(await screen.findByText('resource.skillGroup.installConfirmTitle')).toBeInTheDocument();
    expect(screen.getByText('resource.skillGroup.installableCount')).toBeInTheDocument();
    expect(screen.getByText('resource.skillGroup.applyRequiredCount')).toBeInTheDocument();
    expect(screen.getByText('resource.skillGroup.unavailableCount')).toBeInTheDocument();
    expect(screen.getAllByText('blocked-skill')).toHaveLength(2);
    expect(mockExecuteInstallSkillGroup).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    await waitFor(() =>
      expect(mockExecuteInstallSkillGroup).toHaveBeenCalledWith({ groupId: '101', digitalEmployeeId: '201' })
    );
    expect(await screen.findByText('resource.skillGroup.memberStatus.applyPending')).toBeInTheDocument();
    expect(screen.getByText('resource.skillGroup.memberStatus.unavailable')).toBeInTheDocument();
  });

  it('keeps members visible and reports an install error when installation fails', async () => {
    mockGetSkillGroupDetail.mockResolvedValue({ data: detail });
    mockPreflightInstallSkillGroup.mockRejectedValue(new Error('denied'));

    render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" onClose={jest.fn()} />);
    await screen.findByText('brainstorming');
    fireEvent.click(screen.getByRole('button', { name: 'resource.installSkillGroup' }));

    await waitFor(() => expect(screen.getByTestId('skill-group-detail-install-error')).toBeInTheDocument());
    expect(screen.getByText('user-research')).toBeInTheDocument();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('ignores an install completion after the drawer identity changes', async () => {
    let resolveInstall!: (value: unknown) => void;
    mockGetSkillGroupDetail.mockResolvedValue({ data: detail });
    mockPreflightInstallSkillGroup.mockResolvedValue({
      members: detail.members,
      installed: 0,
      installable: 2,
      applyRequired: 0,
      applyPending: 0,
      unavailable: 0,
    });
    mockExecuteInstallSkillGroup.mockReturnValue(
      new Promise((resolve) => {
        resolveInstall = resolve;
      })
    );

    const { rerender } = render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" />);
    await screen.findByText('brainstorming');
    fireEvent.click(screen.getByRole('button', { name: 'resource.installSkillGroup' }));

    rerender(<SkillGroupDetailDrawer groupId="102" digitalEmployeeId="202" />);
    resolveInstall({ installedSkillIds: ['1'], existingSkillIds: ['2'] });

    await waitFor(() => expect(screen.getByRole('button', { name: 'resource.installSkillGroup' })).not.toBeDisabled());
    expect(mockEmit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('skill-group-detail-install-error')).not.toBeInTheDocument();
  });

  it('ignores an install completion after the drawer closes', async () => {
    let resolveInstall!: (value: unknown) => void;
    mockGetSkillGroupDetail.mockResolvedValue({ data: detail });
    mockPreflightInstallSkillGroup.mockResolvedValue({
      members: detail.members,
      installed: 0,
      installable: 2,
      applyRequired: 0,
      applyPending: 0,
      unavailable: 0,
    });
    mockExecuteInstallSkillGroup.mockReturnValue(
      new Promise((resolve) => {
        resolveInstall = resolve;
      })
    );

    const { unmount } = render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" />);
    await screen.findByText('brainstorming');
    fireEvent.click(screen.getByRole('button', { name: 'resource.installSkillGroup' }));
    unmount();

    resolveInstall({ installedSkillIds: ['1'], existingSkillIds: ['2'] });
    await Promise.resolve();

    expect(mockEmit).not.toHaveBeenCalled();
  });
});
