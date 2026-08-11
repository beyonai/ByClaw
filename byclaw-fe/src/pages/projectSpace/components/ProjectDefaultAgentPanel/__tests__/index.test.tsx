// 角色卡借 ResourceCard 的壳来承载四角色兜底助理配置。
// 这里渲染的是真实 ResourceCard（不 mock），断言三件事：右上角角色 tag、
// 三个点菜单的存在与项目数、以及未指定时标题回落到全局默认提示。
jest.mock('@umijs/max', () => ({
  getIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  getLocale: () => 'zh-CN',
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
  useSelector: (selector: any) =>
    selector({
      user: { userInfo: { defaultDigEmployeeId: 'agent-1' } },
      employees: { defaultDigEmployeeId: 'agent-1', employeesList: [], agentList: [] },
    }),
}));

// 三个点是 antd Dropdown：摊平成可查询的 DOM，才能断言菜单项。
jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  const React = jest.requireActual('react');
  return {
    ...actual,
    Dropdown: ({ children, menu }: { children: React.ReactNode; menu?: { items?: Array<any> } }) => (
      <div>
        {children}
        <div data-testid="dropdown-menu">
          {/* onClick 要一起挂上，否则点菜单项不会触发面板的更换/清除。 */}
          {menu?.items?.map((item: any) => (
            <div key={item?.key} onClick={() => item?.onClick?.()}>
              {item?.label}
            </div>
          ))}
        </div>
      </div>
    ),
  };
});

jest.mock('@/pages/manager/service/resources', () => ({
  queryResourceOperationPermissions: jest.fn(),
  restoreResource: jest.fn(),
}));
jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({
  installDigitalEmployeeRelResources: jest.fn(),
}));
jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: ({ type }: { type: string }) => <span data-testid={`icon-${type}`} />,
}));

// jest.mock 会被提升到 import 之上，工厂里引用的变量必须以 mock 开头才允许。
const mockGetDefaultAgent = jest.fn();
const mockSaveDefaultAgent = jest.fn();
jest.mock('@/service/devloop', () => ({
  getDefaultAgent: (...args: any[]) => mockGetDefaultAgent(...args),
  saveDefaultAgent: (...args: any[]) => mockSaveDefaultAgent(...args),
}));

const mockUseDigitalEmployeeOptions = jest.fn();
jest.mock('../../../hooks/useDigitalEmployeeOptions', () => ({
  useDigitalEmployeeOptions: () => mockUseDigitalEmployeeOptions(),
}));

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectDefaultAgentPanel from '..';

const renderPanel = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectDefaultAgentPanel projectId={1} active />
    </QueryClientProvider>
  );
};

describe('ProjectDefaultAgentPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    class MockIntersectionObserver {
      observe = jest.fn();
      disconnect = jest.fn();
      unobserve = jest.fn();
    }
    Object.defineProperty(window, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: MockIntersectionObserver,
    });
    Object.defineProperty(global, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: MockIntersectionObserver,
    });

    mockUseDigitalEmployeeOptions.mockReturnValue({
      options: [
        // agent-1 带接口返回的 chatAvatar，agent-2 不带 —— 分别验证真实头像与默认兜底。
        { value: 'agent-1', label: '架构专家', chatAvatar: 'oss/agent-1.png' },
        { value: 'agent-2', label: '编码助手' },
      ],
      loading: false,
    });
  });

  it('labels each card with its role tag', async () => {
    mockGetDefaultAgent.mockResolvedValue({});
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('projectSpace.projectForm.defaultAgent.role.architect')).toBeInTheDocument();
    });
    expect(screen.getByText('projectSpace.projectForm.defaultAgent.role.requirement')).toBeInTheDocument();
    expect(screen.getByText('projectSpace.projectForm.defaultAgent.role.coder')).toBeInTheDocument();
    expect(screen.getByText('projectSpace.projectForm.defaultAgent.role.tester')).toBeInTheDocument();
  });

  it('offers the change action on every card and keeps clear hidden until a value is set', async () => {
    // 项目级未指定 → 只有「更换」，没有「清除指定」。
    mockGetDefaultAgent.mockResolvedValue({});
    renderPanel();

    await waitFor(() => {
      expect(screen.getAllByText('projectSpace.defaultAgent.changeAgent')).toHaveLength(4);
    });
    expect(screen.queryByText('projectSpace.defaultAgent.clearAgent')).toBeNull();
  });

  it('shows the clear action only for roles that have a project override', async () => {
    // 全局与项目级用同一个 mock 返回：四角色都算已指定 → 四张卡都出「清除指定」。
    mockGetDefaultAgent.mockResolvedValue({
      architectAgentId: 'agent-1',
      requirementAgentId: 'agent-1',
      coderAgentId: 'agent-2',
      testerAgentId: 'agent-2',
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getAllByText('projectSpace.defaultAgent.clearAgent')).toHaveLength(4);
    });
  });

  it('falls back to the global default hint when the project has no override', async () => {
    mockGetDefaultAgent.mockResolvedValue({});
    renderPanel();

    await waitFor(() => {
      expect(screen.getAllByText('projectSpace.projectForm.defaultAgent.globalUnset')).toHaveLength(4);
    });
  });

  it('titles the card with the picked employee name', async () => {
    mockGetDefaultAgent.mockResolvedValue({ architectAgentId: 'agent-1' });
    renderPanel();

    await waitFor(() => {
      expect(screen.getAllByText('架构专家').length).toBeGreaterThan(0);
    });
  });

  it('renders the employee chatAvatar through the shared agent avatar pipeline', async () => {
    // 头像必须来自接口返回的 chatAvatar，且走 getAgentChatAvatar（圆形 + /byaiService 前缀），
    // 与「数字员工」页同一条管道，而不是面板写死的图标。
    mockGetDefaultAgent.mockResolvedValue({ architectAgentId: 'agent-1' });
    renderPanel();

    // 四张卡在配置回来前就已渲染默认头像，所以要等到那张真实头像出现，而不是等第一个 img。
    const avatar = await waitFor(() => {
      const image = document.querySelector(
        '.roleAvatar img[src="/byaiService/oss/agent-1.png"]'
      ) as HTMLImageElement | null;
      expect(image).not.toBeNull();
      return image as HTMLImageElement;
    });
    expect(avatar.style.borderRadius).toBe('50%');
  });

  it('falls back to the default agent avatar when the employee has no chatAvatar', async () => {
    // agent-2 没有 chatAvatar：getAgentChatAvatar 回落到默认头像，仍是一张图而不是空。
    mockGetDefaultAgent.mockResolvedValue({ coderAgentId: 'agent-2' });
    renderPanel();

    await waitFor(() => {
      expect(screen.getAllByText('编码助手').length).toBeGreaterThan(0);
    });
    const avatars = Array.from(document.querySelectorAll('.roleAvatar img')) as HTMLImageElement[];
    expect(avatars.length).toBe(4);
    expect(avatars.every((image) => !image.getAttribute('src')?.includes('oss/agent-1.png'))).toBe(true);
  });

  it('offers 去聊天 for the effective employee and hands the full mention target to the chat entry', async () => {
    // 「去聊天」带的是当前生效员工的完整信息(id + 名字/头像/类型)，父级据此构造输入框 mention。
    // 只给 agentId 不够：输入框查不到这些员工，会把 @ 兜底成「AI 助手」。
    mockGetDefaultAgent.mockResolvedValue({ architectAgentId: 'agent-1' });
    const onChatWithAgent = jest.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectDefaultAgentPanel projectId={1} active onChatWithAgent={onChatWithAgent} />
      </QueryClientProvider>
    );

    const button = await waitFor(() => screen.getAllByText('projectSpace.defaultAgent.chatWithAgent')[0]);
    // 「去聊天」必须落在创建者那一格(metaNode -> metaPrimary),不能在靠右贴边的 metaHover:
    // 那一侧会和 ResourceCard 绝对定位在右下角的三个点按钮叠住。
    expect(button.closest('.metaPrimary')).not.toBeNull();
    expect(button.closest('.metaHover')).toBeNull();
    fireEvent.click(button);
    expect(onChatWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', name: '架构专家', chatAvatar: 'oss/agent-1.png' })
    );
  });

  it('persists immediately on clear without a save button', async () => {
    // 底部保存按钮已取消：清除即是一次完整提交。
    mockGetDefaultAgent.mockResolvedValue({ architectAgentId: 'agent-1' });
    mockSaveDefaultAgent.mockResolvedValue({});
    renderPanel();

    const clear = await waitFor(() => screen.getAllByText('projectSpace.defaultAgent.clearAgent')[0]);
    expect(screen.queryByText('projectSpace.defaultAgent.save')).toBeNull();

    fireEvent.click(clear);
    await waitFor(() => expect(mockSaveDefaultAgent).toHaveBeenCalledTimes(1));
    // 清除在协议里就是不带该角色 id（assignmentToPayload 把空串归一为 undefined）。
    expect(mockSaveDefaultAgent.mock.calls[0][0]).toMatchObject({ projectId: 1 });
    expect(mockSaveDefaultAgent.mock.calls[0][0].architectAgentId).toBeUndefined();
  });
});
