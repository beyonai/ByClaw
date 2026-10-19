import { getLocale } from '@umijs/max';
jest.mock('@/service/employeePublication', () => ({
  ...jest.requireActual('@/service/employeePublication'),
  openEmployeePublication: jest.fn(),
}));
import { openEmployeePublication } from '@/service/employeePublication';
jest.mock('@umijs/max', () => {
  // 导入 PersonnelModel 常量时就会调用 getIntl，状态必须在 mock 工厂内初始化。
  const getLocale = jest.fn(() => 'zh-CN');
  const getIntl = () => {
    const messages = (
      getLocale() === 'en-US' ? jest.requireActual('@/locales/en-US') : jest.requireActual('@/locales/zh-CN')
    ).default;
    return {
      formatMessage: ({ id }: { id: string }) =>
        messages[id as keyof typeof messages] || (id === 'resource.publishToEnterprise' ? '发布到企业' : id),
    };
  };
  return {
    getIntl,
    getLocale,
    useIntl: getIntl,
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
  };
});

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
  // 即使断言提前失败，也要恢复 message 的 spy，保证真正执行全局消息清理。
  jest.restoreAllMocks();
  // 全局 message 不属于 render 容器，必须单独清理，避免提示和计时器跨用例残留。
  await act(async () => {
    message.destroy();
  });
  (getLocale as jest.Mock).mockReturnValue('zh-CN');
});

describe('digital employee publication entry', () => {
  it.each([
    ['zh-CN', '发布到企业', '正在准备发布申请，请稍候…'],
    ['en-US', 'Publish to enterprise', 'Preparing the publication request. Please wait…'],
  ])(
    'localizes preparation feedback in %s and blocks duplicate clicks until navigation is ready',
    async (locale, label, feedback) => {
      (getLocale as jest.Mock).mockReturnValue(locale);
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
      const entry = screen.getByText(label);
      fireEvent.click(entry);
      fireEvent.click(entry);
      expect(openEmployeePublication).toHaveBeenCalledTimes(1);
      expect(loading).toHaveBeenCalledWith(expect.objectContaining({ content: feedback, duration: 0 }));
      expect(destroy).not.toHaveBeenCalled();
      await act(async () => {
        finish();
      });
      expect(destroy).toHaveBeenCalledWith('employee-publication-open-10');
      loading.mockRestore();
      destroy.mockRestore();
    }
  );
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
    fireEvent.click(screen.getByText('发布到企业'));
    await waitFor(() => expect(error).toHaveBeenCalledWith('仅在用数字员工支持发起发布或更新'));
    error.mockRestore();
  });
  it.each([
    [undefined, '发布到企业'],
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
    const expectedArgs = status === 'PUBLISHED' ? ['10', 'publishUpdate'] : ['10'];
    await waitFor(() => expect(openEmployeePublication).toHaveBeenCalledWith(...expectedArgs));
  });
  it.each([
    ['zh-CN', '查看发布记录'],
    ['en-US', 'View publication history'],
  ])('views a published record in %s without preparing another update', async (locale, label) => {
    (getLocale as jest.Mock).mockReturnValue(locale);
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
    fireEvent.click(screen.getByText(label));
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
    expect(screen.queryByText('发布到企业')).not.toBeInTheDocument();
  });
  it.each([
    ['zh-CN', '编辑信息'],
    ['en-US', 'Edit Info'],
  ])('opens an official copy in its ordinary editor in %s without preparing a publication', (locale, label) => {
    (getLocale as jest.Mock).mockReturnValue(locale);
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
    fireEvent.click(screen.getByText(label));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(openEmployeePublication).not.toHaveBeenCalled();
  });
});
