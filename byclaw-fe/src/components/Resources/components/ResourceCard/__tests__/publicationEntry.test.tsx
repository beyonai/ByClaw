jest.mock('@/service/employeePublication', () => ({
  ...jest.requireActual('@/service/employeePublication'),
  openEmployeePublication: jest.fn(),
}));
import { openEmployeePublication } from '@/service/employeePublication';
jest.mock('@umijs/max', () => ({
  getIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
  getLocale: () => 'zh-CN',
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
  useDispatch: () => jest.fn(),
  useSelector: (selector: any) =>
    selector({
      user: {
        userInfo: {
          defaultDigEmployeeId: 'default-agent-1',
        },
      },
      employees: {
        defaultDigEmployeeId: 'default-agent-1',
      },
    }),
}));

jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  const React = jest.requireActual('react');

  return {
    ...actual,
    // 保留真实确认交互，去掉弹层动画准备阶段，避免全量运行时等待过渡。
    Popconfirm: (props: import('antd').PopconfirmProps) => <actual.Popconfirm {...props} transitionName="" />,
    Dropdown: ({ children, menu }: { children: React.ReactNode; menu?: { items?: Array<any> } }) => (
      <div>
        {children}
        <div>
          {menu?.items?.map((item) => (
            // 模拟 Menu 的条目点击分发，禁用项不触发业务回调。
            <div
              key={item?.key}
              data-testid={`resource-menu-${item?.key}`}
              onClick={item?.disabled ? undefined : item?.onClick}
            >
              {item?.label}
            </div>
          ))}
        </div>
      </div>
    ),
  };
});

jest.mock('@/pages/manager/service/resources', () => ({
  publishSkillToEnterprise: jest.fn(),
  getSkillPublicationPermissions: jest.fn(),
  checkWorkspaceSkillShareConflicts: jest.fn(),
  resourceizeWorkspaceSkill: jest.fn(),
  queryWorkspaceSkillDetail: jest.fn(),
  queryResourceMembers: jest.fn(),
}));

jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({
  installDigitalEmployeeRelResources: jest.fn(),
}));

jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: ({ type, className }: { type: string; className?: string }) => (
    <span className={className} data-testid={`icon-${type}`} />
  ),
}));

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider, message } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ResourceCard from '..';

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </ConfigProvider>
  );
};

afterEach(async () => {
  // 全局 message 不属于 render 容器，必须单独清理，避免提示和计时器跨用例残留。
  await act(async () => {
    message.destroy();
  });
});

describe('digital employee publication entry', () => {
  it('keeps preparation feedback visible and blocks duplicate clicks until navigation is ready', async () => {
    let finish!: () => void;
    (openEmployeePublication as jest.Mock).mockClear().mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const loading = jest.spyOn(message, 'loading').mockImplementation(jest.fn());
    const destroy = jest.spyOn(message, 'destroy').mockImplementation(jest.fn());
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          canPublishEmployee: true,
        }}
      />
    );
    const entry = screen.getByText('发布到官方推荐');
    fireEvent.click(entry);
    fireEvent.click(entry);
    expect(openEmployeePublication).toHaveBeenCalledTimes(1);
    expect(loading).toHaveBeenCalledWith(
      expect.objectContaining({ content: '正在准备发布申请，请稍候…', duration: 0 })
    );
    expect(destroy).not.toHaveBeenCalled();
    await act(async () => {
      finish();
    });
    expect(destroy).toHaveBeenCalledWith('employee-publication-open-10');
    loading.mockRestore();
    destroy.mockRestore();
  });
  it('displays the concrete server message when draft preparation rejects a string', async () => {
    (openEmployeePublication as jest.Mock).mockRejectedValueOnce('仅在用数字员工支持发起发布或更新');
    const error = jest.spyOn(message, 'error').mockImplementation(jest.fn());
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          canPublishEmployee: true,
        }}
      />
    );
    fireEvent.click(screen.getByText('发布到官方推荐'));
    await waitFor(() => expect(error).toHaveBeenCalledWith('仅在用数字员工支持发起发布或更新'));
    error.mockRestore();
  });
  it.each([
    [undefined, '发布到官方推荐'],
    ['DRAFT', '继续发布'],
    ['PENDING', '查看发布进度'],
    ['APPLYING', '查看发布进度'],
    ['REJECTED', '查看审核结果'],
    ['WITHDRAWN', '查看发布申请'],
    ['FAILED', '查看发布结果'],
    ['PUBLISHED', '发布更新'],
  ])('shows the entry for %s and opens the existing request', async (status, label) => {
    (openEmployeePublication as jest.Mock).mockClear().mockResolvedValue(undefined);
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          canPublishEmployee: true,
          employeePublicationStatus: status,
        }}
      />
    );
    fireEvent.click(screen.getByText(label!));
    await waitFor(() => {
      if (status === 'PUBLISHED') expect(openEmployeePublication).toHaveBeenCalledWith('10', 'publishUpdate');
      else expect(openEmployeePublication).toHaveBeenCalledWith('10');
    });
  });
  it('views a published record without preparing another update', async () => {
    (openEmployeePublication as jest.Mock).mockClear().mockResolvedValue(undefined);
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          canPublishEmployee: true,
          employeePublicationStatus: 'PUBLISHED',
        }}
      />
    );
    fireEvent.click(screen.getByText('查看发布记录'));
    await waitFor(() => expect(openEmployeePublication).toHaveBeenCalledWith('10'));
    expect(openEmployeePublication).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['DRAFT', '继续发布更新'],
    ['PENDING', '查看更新进度'],
  ])('identifies a %s update candidate separately from an initial publication', (status, label) => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          canPublishEmployee: true,
          employeePublicationStatus: status,
          employeePublicationUpdate: true,
        }}
      />
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });
  it('only offers publication when the backend allows it', () => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          canPublishEmployee: false,
        }}
      />
    );
    expect(screen.queryByText('发布到官方推荐')).not.toBeInTheDocument();
  });
  it('opens an official copy in its ordinary editor without preparing a publication', async () => {
    (openEmployeePublication as jest.Mock).mockReset();
    const onEdit = jest.fn();
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'enterprise',
          canEdit: true,
          officialPublication: true,
        }}
        actionConfig={{ onEdit }}
      />
    );
    fireEvent.click(screen.getByText('common.editInfo'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(openEmployeePublication).not.toHaveBeenCalled();
  });
});
