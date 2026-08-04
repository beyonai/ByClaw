jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

const mockGetSkillGroupDetail = jest.fn();
const mockInstallSkillGroup = jest.fn();
const mockEmit = jest.fn();

jest.mock('@/pages/manager/service/resources', () => ({
  getSkillGroupDetail: (...args: any[]) => mockGetSkillGroupDetail(...args),
  installSkillGroup: (...args: any[]) => mockInstallSkillGroup(...args),
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: { emit: mockEmit } }),
}));

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    mockInstallSkillGroup.mockReset();
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
  });

  it('renders an empty state for a missing detail and an error state for a failed request', async () => {
    mockGetSkillGroupDetail.mockResolvedValueOnce({ data: null });
    const { rerender } = render(<SkillGroupDetailDrawer groupId="101" digitalEmployeeId="201" onClose={jest.fn()} />);
    expect(await screen.findByTestId('skill-group-detail-empty')).toBeInTheDocument();

    mockGetSkillGroupDetail.mockRejectedValueOnce(new Error('network error'));
    rerender(<SkillGroupDetailDrawer groupId="102" digitalEmployeeId="201" onClose={jest.fn()} />);
    expect(await screen.findByTestId('skill-group-detail-error')).toBeInTheDocument();
  });

  it('disables install without an active employee and emits refresh events after success', async () => {
    mockGetSkillGroupDetail.mockResolvedValue({ data: detail });
    mockInstallSkillGroup.mockResolvedValue({
      installedSkillIds: ['1', '2'],
      existingSkillIds: ['3'],
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
      expect(mockInstallSkillGroup).toHaveBeenCalledWith({ groupId: '101', digitalEmployeeId: '201' })
    );
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

  it('keeps members visible and reports an install error when installation fails', async () => {
    mockGetSkillGroupDetail.mockResolvedValue({ data: detail });
    mockInstallSkillGroup.mockRejectedValue(new Error('denied'));

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
    mockInstallSkillGroup.mockReturnValue(
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
    mockInstallSkillGroup.mockReturnValue(
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
