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
          {menu?.items?.map((item: any) => (
            <div key={item?.key}>{item?.label}</div>
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
jest.mock('@/service/devloop', () => ({
  getDefaultAgent: (...args: any[]) => mockGetDefaultAgent(...args),
  saveDefaultAgent: jest.fn(),
}));

const mockUseDigitalEmployeeOptions = jest.fn();
jest.mock('../../../hooks/useDigitalEmployeeOptions', () => ({
  useDigitalEmployeeOptions: () => mockUseDigitalEmployeeOptions(),
}));

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
        // agent-1 带接口返回的头像路径，agent-2 不带 —— 用来分别验证真实图片与默认兜底。
        { value: 'agent-1', label: '架构专家', logo: 'oss/agent-1.png' },
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

  it('shows the employee avatar returned by the list API instead of a hardcoded icon', async () => {
    // 头像必须来自接口返回的 logo（经 getFileUrl 前缀化），而不是面板写死的图标。
    mockGetDefaultAgent.mockResolvedValue({ architectAgentId: 'agent-1' });
    renderPanel();

    const avatar = await waitFor(() => {
      const image = document.querySelector('img[alt="架构专家"]') as HTMLImageElement | null;
      expect(image).not.toBeNull();
      return image as HTMLImageElement;
    });
    expect(avatar.getAttribute('src')).toBe('/byaiService/oss/agent-1.png');
  });

  it('leaves the avatar to ResourceCard default when the employee has no logo', async () => {
    // agent-2 没有 logo：不应渲染 <img>，交给 ResourceCard 自己回落默认图标。
    mockGetDefaultAgent.mockResolvedValue({ coderAgentId: 'agent-2' });
    renderPanel();

    await waitFor(() => {
      expect(screen.getAllByText('编码助手').length).toBeGreaterThan(0);
    });
    expect(document.querySelector('img[alt="编码助手"]')).toBeNull();
  });
});
