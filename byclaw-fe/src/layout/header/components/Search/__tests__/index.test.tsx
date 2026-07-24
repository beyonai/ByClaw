import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import Search from '..';
import { getSearchList } from '@/service/layout';
import {
  listResourceUseAuth,
  queryDigEmployeeRelResourceAuth,
  queryResourceMembers,
} from '@/pages/manager/service/resources';
import { message } from 'antd';

let mockVisibleMenuKeys: string[] = [];
let mockActiveSiderAgent: { resourceId?: string; name?: string } = {};
const mockEventEmitter = {
  emit: jest.fn(),
};
const mockIntl = {
  formatMessage: jest.fn(({ id }: { id: string }) => {
    if (id === 'search.referenceSuccess') {
      return '引用成功';
    }
    if (id === 'headerSearch.currentKnowledge') {
      return '当前知识';
    }
    if (id === 'headerSearch.personalKnowledge') {
      return '个人知识';
    }
    if (id === 'headerSearch.enterpriseKnowledge') {
      return '企业知识';
    }
    if (id === 'headerSearch.quotableTip') {
      return '（可引用）';
    }
    if (id === 'headerSearch.currentTool') {
      return '当前工具';
    }
    if (id === 'headerSearch.personalTool') {
      return '个人工具';
    }
    if (id === 'headerSearch.enterpriseTool') {
      return '企业工具';
    }
    if (id === 'headerSearch.currentView') {
      return '当前视图';
    }
    if (id === 'headerSearch.personalView') {
      return '个人视图';
    }
    if (id === 'headerSearch.enterpriseView') {
      return '企业视图';
    }
    return id;
  }),
};

jest.mock('@umijs/max', () => ({
  connect: () => (Component: React.ComponentType<any>) => Component,
  useDispatch: () => jest.fn(),
  useIntl: () => mockIntl,
  useNavigate: () => jest.fn(),
  useSelector: (selector: (state: any) => any) =>
    selector({
      user: {
        userInfo: {
          userCode: 'U001',
        },
      },
    }),
}));

jest.mock('antd', () => {
  const actual = jest.requireActual('antd');

  return {
    ...actual,
    message: {
      ...actual.message,
      success: jest.fn(),
    },
  };
});

jest.mock('@/service/layout', () => ({
  getSearchList: jest.fn(),
}));

jest.mock('@/pages/manager/service/resources', () => ({
  listResourceUseAuth: jest.fn(),
  queryDigEmployeeRelResourceAuth: jest.fn(),
  queryResourceMembers: jest.fn(),
}));

jest.mock('@/layout/sider/useVisibleMenuKeys', () => ({
  __esModule: true,
  default: () => mockVisibleMenuKeys,
}));

jest.mock('@/layout/sider/components/ActiveSiderAgentBar', () => ({
  __esModule: true,
  useActiveSiderAgent: () => mockActiveSiderAgent,
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({
    setAgentId: jest.fn(),
    setSessionId: jest.fn(),
    EventEmitter: mockEventEmitter,
  }),
}));

jest.mock('@/hooks/useTracker', () => ({
  __esModule: true,
  default: () => ({
    trackerEmployeeClick: jest.fn(),
  }),
}));

jest.mock('@/pages/digitalEmployees/components/AllDigitalEmployees/RenderRightTop', () => ({
  __esModule: true,
  default: () => <span data-testid="render-right-top" />,
}));

jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: ({ type }: { type: string }) => <span data-testid={type} />,
}));

jest.mock('@/layout/sider/components/Knowledge/components/KnowledgeBase/KnowledgeBaseListItem', () => ({
  __esModule: true,
  default: ({ item, onClick, onDoubleClick }: any) => (
    <button
      data-testid="knowledge-base-list-item"
      type="button"
      onClick={(event) => onClick?.(event, item)}
      onDoubleClick={(event) => onDoubleClick?.(event, item)}
    >
      {item.resourceName}
    </button>
  ),
}));

jest.mock('@/layout/sider/components/ResourceSiderPanel/ResourceSiderListItem', () => {
  const actual = jest.requireActual('@/layout/sider/components/ResourceSiderPanel/ResourceSiderListItem');

  return {
    __esModule: true,
    ...actual,
    default: ({ item, resourceType, drillable, renderName, renderDescription, onClick, onDoubleClick }: any) => (
      <button
        data-testid={`resource-sider-list-item-${resourceType}`}
        type="button"
        data-drillable={drillable ? 'true' : 'false'}
        onClick={() => onClick?.(item, drillable)}
        onDoubleClick={() => onDoubleClick?.(item)}
      >
        <span>{renderName ? renderName(item) : item.resourceName}</span>
        <span>{renderDescription ? renderDescription(item) : item.resourceDesc}</span>
      </button>
    ),
  };
});

jest.mock('@/layout/sider/components/Knowledge/components/KnowledgeBase/KnowledgeBaseDetail', () => ({
  __esModule: true,
  default: ({ dataset, onGoBack, onFileClick, quoteDisabled }: any) => (
    <div data-testid="knowledge-base-detail">
      <span>{dataset.resourceName}</span>
      <button
        type="button"
        data-testid="knowledge-detail-node"
        onClick={() => onFileClick?.({ id: 'knowledge-file-1', name: 'Knowledge File' })}
        onDoubleClick={() => {
          if (!quoteDisabled) {
            mockEventEmitter.emit('queryInput-insert-item', {
              item: { id: 'knowledge-file-1', name: 'Knowledge File' },
              type: 'knowledgeFile',
            });
          }
        }}
      >
        file
      </button>
      <button type="button" onClick={onGoBack}>
        back
      </button>
    </div>
  ),
}));

jest.mock('@/utils/agent', () => ({
  agentHandler: (item: any) => item,
  canJumpAgent: () => true,
  getAgentChatAvatar: () => null,
  getAgentPath: (item: any) => `/agent/${item.id}`,
  getAvatarUrl: (avatar: string) => avatar,
}));

const mockGetSearchList = getSearchList as jest.MockedFunction<typeof getSearchList>;
const mockListResourceUseAuth = listResourceUseAuth as jest.MockedFunction<typeof listResourceUseAuth>;
const mockQueryDigEmployeeRelResourceAuth = queryDigEmployeeRelResourceAuth as jest.MockedFunction<
  typeof queryDigEmployeeRelResourceAuth
>;
const mockQueryResourceMembers = queryResourceMembers as jest.MockedFunction<typeof queryResourceMembers>;
const mockMessageSuccess = message.success as jest.MockedFunction<typeof message.success>;

beforeEach(() => {
  jest.useFakeTimers();
  mockVisibleMenuKeys = [];
  mockActiveSiderAgent = {};
  mockGetSearchList.mockReset();
  mockGetSearchList.mockResolvedValue({
    digitList: [],
    userList: [],
    sessionList: [],
  });
  mockQueryDigEmployeeRelResourceAuth.mockReset();
  mockQueryDigEmployeeRelResourceAuth.mockResolvedValue({ rows: [] });
  mockListResourceUseAuth.mockReset();
  mockListResourceUseAuth.mockResolvedValue({ data: { rows: [] } });
  mockQueryResourceMembers.mockReset();
  mockQueryResourceMembers.mockResolvedValue({});
  mockEventEmitter.emit.mockClear();
  mockMessageSuccess.mockClear();
  mockIntl.formatMessage.mockClear();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

async function flushSearch() {
  await act(async () => {
    jest.runOnlyPendingTimers();
    // 资源搜索包含多层 Promise.allSettled，需要等待完整异步链路提交页面状态。
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Header Search', () => {
  it('renders empty state when only userList has results', async () => {
    mockGetSearchList.mockResolvedValue({
      digitList: [],
      userList: [{ id: 'user-1', name: 'User One' }],
      sessionList: [],
    });

    render(<Search showSearch setShowSearch={jest.fn()} />);

    await flushSearch();

    expect(await screen.findByText('workCenter.noContent')).toBeInTheDocument();
  });

  it('uses an explicitly controlled empty keyword instead of stale input text', async () => {
    const { rerender } = render(<Search showSearch displayInModal setShowSearch={jest.fn()} />);

    await flushSearch();
    mockGetSearchList.mockClear();

    const input = screen.getByPlaceholderText('layouHeader.search');
    fireEvent.change(input, { target: { value: 'stale keyword' } });

    rerender(<Search showSearch displayInModal keyword="" setShowSearch={jest.fn()} />);
    await flushSearch();

    await waitFor(() => {
      expect(mockGetSearchList).toHaveBeenLastCalledWith(
        expect.objectContaining({ keyword: '' }),
        expect.any(AbortController)
      );
    });
  });

  it('applies the caller className to the root wrapper', async () => {
    const { container } = render(
      <Search {...({ showSearch: true, setShowSearch: jest.fn(), className: 'custom-search' } as any)} />
    );

    expect(container.firstElementChild).toHaveClass('custom-search');
    await flushSearch();
  });

  it('cancels pending search and aborts active request when hidden', async () => {
    const abortSpy = jest.spyOn(AbortController.prototype, 'abort');
    const { rerender } = render(<Search showSearch keyword="abc" setShowSearch={jest.fn()} />);
    await flushSearch();
    expect(mockGetSearchList).toHaveBeenCalled();
    mockGetSearchList.mockClear();

    rerender(<Search showSearch={false} keyword="abc" setShowSearch={jest.fn()} />);
    await flushSearch();

    expect(mockGetSearchList).not.toHaveBeenCalled();
    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });

  it('adds visible employee resource tabs and queries each one for the active sider agent', async () => {
    mockVisibleMenuKeys = ['knowledge', 'tool'];
    mockActiveSiderAgent = { resourceId: 'agent-1', name: 'Agent One' };
    mockQueryDigEmployeeRelResourceAuth.mockImplementation(({ resourceBizTypeList }: any) => {
      if (resourceBizTypeList.includes('KG_DOC')) {
        return Promise.resolve({
          rows: [
            {
              resourceId: 'knowledge-resource-1',
              resourceName: 'Knowledge Result',
              resourceDesc: 'Knowledge Desc',
              resourceBizType: 'KG_DOC',
            },
          ],
        });
      }

      return Promise.resolve({
        rows: [
          {
            resourceId: 'tool-resource-1',
            resourceName: 'Tool Result',
            resourceDesc: 'Tool Desc',
            resourceBizType: 'TOOLKIT',
          },
        ],
      });
    });

    render(<Search showSearch setShowSearch={jest.fn()} />);

    await flushSearch();

    await waitFor(() => {
      expect(mockQueryDigEmployeeRelResourceAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          pageNum: 1,
          pageSize: 20,
          keyword: '',
          resourceId: 'agent-1',
          resourceBizTypeList: ['KG_DOC', 'KG_QA', 'KG_TERM'],
        })
      );
      expect(mockQueryDigEmployeeRelResourceAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          pageNum: 1,
          pageSize: 20,
          keyword: '',
          resourceId: 'agent-1',
          resourceBizTypeList: ['AGENT', 'MCP', 'TOOLKIT'],
        })
      );
      expect(mockQueryDigEmployeeRelResourceAuth).toHaveBeenCalledTimes(2);
    });
    expect(screen.getAllByText('sider.knowledge').length).toBeGreaterThan(0);
    expect(screen.getAllByText('common.tool').length).toBeGreaterThan(0);
    expect(await screen.findByText('Knowledge Result')).toBeInTheDocument();
    expect(await screen.findByText('Tool Result')).toBeInTheDocument();
    expect(
      screen.getByTestId('resource-sider-list-item-TOOL').closest('.employeeResourceSiderList')
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('common.tool')[0]);

    expect(screen.queryByText('Knowledge Result')).not.toBeInTheDocument();
    expect(screen.getByText('Tool Result')).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByTestId('resource-sider-list-item-TOOL'));
    fireEvent.doubleClick(screen.getByTestId('resource-sider-list-item-TOOL'));

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queryInput-insert-item', {
      item: expect.objectContaining({
        isFromResourceModule: true,
        resourceId: 'tool-resource-1',
        resourceName: 'Tool Result',
      }),
      type: 'tool',
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mockIntl.formatMessage).toHaveBeenCalledWith({ id: 'search.referenceSuccess' });
    expect(mockMessageSuccess).toHaveBeenCalledWith('引用成功');
    expect(mockMessageSuccess).toHaveBeenCalledTimes(1);
  });

  it('only expands current knowledge by default in grouped collapse sections', async () => {
    mockVisibleMenuKeys = ['knowledge'];
    mockActiveSiderAgent = { resourceId: 'agent-1', name: 'Agent One' };
    mockQueryDigEmployeeRelResourceAuth.mockResolvedValue({
      rows: [
        {
          resourceId: 'current-knowledge-1',
          resourceName: 'Current Knowledge',
          resourceDesc: 'Current Desc',
          resourceBizType: 'KG_DOC',
        },
        {
          resourceId: 'current-knowledge-2',
          resourceName: 'Current Knowledge 2',
          resourceDesc: 'Current Desc 2',
          resourceBizType: 'KG_DOC',
        },
        {
          resourceId: 'current-knowledge-3',
          resourceName: 'Current Knowledge 3',
          resourceDesc: 'Current Desc 3',
          resourceBizType: 'KG_DOC',
        },
      ],
    });
    mockListResourceUseAuth.mockImplementation(({ ownerType }: any) => {
      if (ownerType === 'personal') {
        return Promise.resolve({
          data: {
            rows: [
              {
                resourceId: 'personal-knowledge-1',
                resourceName: 'Personal Knowledge',
                resourceDesc: 'Personal Desc',
                resourceBizType: 'KG_DOC',
              },
            ],
          },
        } as any);
      }

      return Promise.resolve({
        data: {
          rows: [
            {
              resourceId: 'enterprise-knowledge-1',
              resourceName: 'Enterprise Knowledge',
              resourceDesc: 'Enterprise Desc',
              resourceBizType: 'KG_DOC',
            },
          ],
        },
      } as any);
    });

    render(<Search showSearch setShowSearch={jest.fn()} />);

    await flushSearch();

    expect(await screen.findByText('当前知识')).toBeInTheDocument();
    expect(screen.getAllByText('（可引用）')[0]).toHaveClass('resourceGroupTitleTip');
    expect(screen.getByText('个人知识')).toBeInTheDocument();
    expect(screen.getByText('企业知识')).toBeInTheDocument();
    expect(screen.getByText('Current Knowledge')).toBeInTheDocument();
    expect(screen.getByText('当前知识').closest('[role="button"]')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('个人知识').closest('[role="button"]')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('企业知识').closest('[role="button"]')).toHaveAttribute('aria-expanded', 'false');

    expect(mockQueryDigEmployeeRelResourceAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        pageNum: 1,
        pageSize: 20,
        keyword: '',
        resourceId: 'agent-1',
        resourceBizTypeList: ['KG_DOC', 'KG_QA', 'KG_TERM'],
      })
    );
    expect(mockListResourceUseAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        pageNum: 1,
        pageSize: 20,
        keyword: '',
        ownerType: 'personal',
        resourceStatus: '2',
        permission: '',
        resourceBizTypeList: ['KG_DOC', 'KG_QA', 'KG_TERM'],
      })
    );
    expect(mockListResourceUseAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        pageNum: 1,
        pageSize: 20,
        keyword: '',
        ownerType: 'enterprise',
        resourceStatus: '2',
        belong: 'ALL',
        permission: '',
        resourceBizTypeList: ['KG_DOC', 'KG_QA', 'KG_TERM'],
      })
    );
  });

  it('only expands current tool by default and disables quote for resource center tools', async () => {
    mockVisibleMenuKeys = ['tool'];
    mockActiveSiderAgent = { resourceId: 'agent-1', name: 'Agent One' };
    mockQueryDigEmployeeRelResourceAuth.mockResolvedValue({
      rows: [
        {
          resourceId: 'current-tool-1',
          resourceName: 'Current Tool',
          resourceDesc: 'Current Tool Desc',
          resourceBizType: 'TOOLKIT',
        },
      ],
    });
    mockListResourceUseAuth.mockImplementation(({ ownerType }: any) => {
      if (ownerType === 'personal') {
        return Promise.resolve({
          data: {
            rows: [
              {
                resourceId: 'personal-tool-1',
                resourceName: 'Personal Tool',
                resourceDesc: 'Personal Tool Desc',
                resourceBizType: 'TOOLKIT',
              },
            ],
          },
        } as any);
      }

      return Promise.resolve({
        data: {
          rows: [
            {
              resourceId: 'enterprise-tool-1',
              resourceName: 'Enterprise Tool',
              resourceDesc: 'Enterprise Tool Desc',
              resourceBizType: 'TOOLKIT',
            },
          ],
        },
      } as any);
    });

    render(<Search showSearch setShowSearch={jest.fn()} />);

    await flushSearch();

    expect(await screen.findByText('当前工具')).toBeInTheDocument();
    expect(screen.getAllByText('（可引用）')[0]).toHaveClass('resourceGroupTitleTip');
    expect(screen.getByText('个人工具')).toBeInTheDocument();
    expect(screen.getByText('企业工具')).toBeInTheDocument();
    expect(screen.getByText('Current Tool')).toBeInTheDocument();
    expect(screen.getByText('当前工具').closest('[role="button"]')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('个人工具').closest('[role="button"]')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('企业工具').closest('[role="button"]')).toHaveAttribute('aria-expanded', 'false');

    expect(mockListResourceUseAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        pageNum: 1,
        pageSize: 20,
        keyword: '',
        ownerType: 'personal',
        resourceStatus: '2',
        permission: '',
        resourceBizTypeList: ['AGENT', 'MCP', 'TOOLKIT'],
      })
    );
    expect(mockListResourceUseAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        pageNum: 1,
        pageSize: 20,
        keyword: '',
        ownerType: 'enterprise',
        resourceStatus: '2',
        belong: 'ALL',
        permission: '',
        resourceBizTypeList: ['AGENT', 'MCP', 'TOOLKIT'],
      })
    );

    fireEvent.doubleClick(screen.getByText('Current Tool'));
    fireEvent.click(screen.getByText('个人工具').closest('[role="button"]')!);
    fireEvent.click(screen.getByText('企业工具').closest('[role="button"]')!);
    fireEvent.doubleClick(screen.getByText('Personal Tool'));
    fireEvent.doubleClick(screen.getByText('Enterprise Tool'));

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queryInput-insert-item', {
      item: expect.objectContaining({
        isFromResourceModule: true,
        resourceId: 'current-tool-1',
        resourceName: 'Current Tool',
      }),
      type: 'tool',
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mockMessageSuccess).toHaveBeenCalledTimes(1);
  });

  it('hides empty knowledge groups and searches personal and enterprise knowledge with the keyword', async () => {
    mockVisibleMenuKeys = ['knowledge'];
    mockActiveSiderAgent = { resourceId: 'agent-1', name: 'Agent One' };
    mockQueryDigEmployeeRelResourceAuth.mockResolvedValue({ rows: [] });
    mockListResourceUseAuth.mockImplementation(({ ownerType, keyword }: any) => {
      if (ownerType === 'enterprise' && keyword === 'finance') {
        return Promise.resolve({
          data: {
            rows: [
              {
                resourceId: 'enterprise-knowledge-1',
                resourceName: 'Finance Knowledge',
                resourceDesc: 'Enterprise Desc',
                resourceBizType: 'KG_DOC',
              },
            ],
          },
        } as any);
      }

      return Promise.resolve({ data: { rows: [] } } as any);
    });

    render(<Search showSearch displayInModal setShowSearch={jest.fn()} />);

    await flushSearch();

    fireEvent.change(screen.getByPlaceholderText('layouHeader.search'), { target: { value: 'finance' } });
    await flushSearch();

    expect(await screen.findByText('企业知识')).toBeInTheDocument();
    expect(screen.getByText('企业知识').closest('[role="button"]')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Finance Knowledge')).toBeInTheDocument();
    expect(screen.queryByText('当前知识')).not.toBeInTheDocument();
    expect(screen.queryByText('个人知识')).not.toBeInTheDocument();

    expect(mockListResourceUseAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: 'finance',
        ownerType: 'personal',
        resourceStatus: '2',
        permission: '',
        resourceBizTypeList: ['KG_DOC', 'KG_QA', 'KG_TERM'],
      })
    );
    expect(mockListResourceUseAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: 'finance',
        ownerType: 'enterprise',
        resourceStatus: '2',
        belong: 'ALL',
        permission: '',
        resourceBizTypeList: ['KG_DOC', 'KG_QA', 'KG_TERM'],
      })
    );
  });

  it('uses the knowledge base list item interaction and drills into knowledge detail', async () => {
    mockVisibleMenuKeys = ['knowledge'];
    mockActiveSiderAgent = { resourceId: 'agent-1', name: 'Agent One' };
    mockQueryDigEmployeeRelResourceAuth.mockResolvedValue({
      rows: [
        {
          resourceId: 'knowledge-resource-1',
          resourceName: 'Knowledge Result',
          resourceDesc: 'Knowledge Desc',
          resourceBizType: 'KG_DOC',
        },
      ],
    });

    render(<Search showSearch setShowSearch={jest.fn()} />);

    await flushSearch();

    const knowledgeBaseListItem = await screen.findByTestId('knowledge-base-list-item');
    expect(knowledgeBaseListItem.closest('.knowledgeResourceList')).toBeInTheDocument();

    fireEvent.click(knowledgeBaseListItem);
    await act(async () => {
      jest.advanceTimersByTime(220);
      await Promise.resolve();
    });

    expect(screen.getByTestId('knowledge-base-detail')).toBeInTheDocument();
  });

  it('closes search after single-clicking a file in knowledge detail', async () => {
    const setShowSearch = jest.fn();
    mockVisibleMenuKeys = ['knowledge'];
    mockActiveSiderAgent = { resourceId: 'agent-1', name: 'Agent One' };
    mockQueryDigEmployeeRelResourceAuth.mockResolvedValue({
      rows: [
        {
          resourceId: 'knowledge-resource-1',
          resourceName: 'Knowledge Result',
          resourceDesc: 'Knowledge Desc',
          resourceBizType: 'KG_DOC',
        },
      ],
    });

    render(<Search showSearch setShowSearch={setShowSearch} />);

    await flushSearch();

    fireEvent.click(await screen.findByTestId('knowledge-base-list-item'));
    await act(async () => {
      jest.advanceTimersByTime(220);
      await Promise.resolve();
    });

    fireEvent.click(screen.getByTestId('knowledge-detail-node'));

    expect(setShowSearch).toHaveBeenCalledWith(false);
  });

  it('resets the knowledge tab to the root list when searching after opening detail', async () => {
    mockVisibleMenuKeys = ['knowledge'];
    mockActiveSiderAgent = { resourceId: 'agent-1', name: 'Agent One' };
    mockQueryDigEmployeeRelResourceAuth.mockResolvedValue({
      rows: [
        {
          resourceId: 'knowledge-resource-1',
          resourceName: 'Knowledge Result',
          resourceDesc: 'Knowledge Desc',
          resourceBizType: 'KG_DOC',
        },
      ],
    });

    render(<Search showSearch displayInModal setShowSearch={jest.fn()} />);

    await flushSearch();

    fireEvent.click(screen.getAllByText('sider.knowledge')[0]);

    const knowledgeBaseListItem = await screen.findByTestId('knowledge-base-list-item');
    fireEvent.click(knowledgeBaseListItem);
    await act(async () => {
      jest.advanceTimersByTime(220);
      await Promise.resolve();
    });

    expect(screen.getByTestId('knowledge-base-detail')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('layouHeader.search'), { target: { value: 'new keyword' } });
    await flushSearch();

    expect(screen.queryByTestId('knowledge-base-detail')).not.toBeInTheDocument();
    expect(await screen.findByTestId('knowledge-base-list-item')).toBeInTheDocument();
  });

  it('shows a success message after double-clicking a knowledge item to emit insert event', async () => {
    mockVisibleMenuKeys = ['knowledge'];
    mockActiveSiderAgent = { resourceId: 'agent-1', name: 'Agent One' };
    mockQueryDigEmployeeRelResourceAuth.mockResolvedValue({
      rows: [
        {
          resourceId: 'knowledge-resource-1',
          resourceName: 'Knowledge Result',
          resourceDesc: 'Knowledge Desc',
          resourceBizType: 'KG_DOC',
        },
      ],
    });

    render(<Search showSearch setShowSearch={jest.fn()} />);

    await flushSearch();

    const knowledgeBaseListItem = await screen.findByTestId('knowledge-base-list-item');
    fireEvent.doubleClick(knowledgeBaseListItem);
    fireEvent.doubleClick(knowledgeBaseListItem);

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queryInput-insert-item', {
      item: expect.objectContaining({
        resourceId: 'knowledge-resource-1',
        resourceName: 'Knowledge Result',
      }),
      type: 'KG_DOC',
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mockIntl.formatMessage).toHaveBeenCalledWith({ id: 'search.referenceSuccess' });
    expect(mockMessageSuccess).toHaveBeenCalledWith('引用成功');
    expect(mockMessageSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not quote personal or enterprise knowledge by double-clicking list items or detail files', async () => {
    mockVisibleMenuKeys = ['knowledge'];
    mockActiveSiderAgent = { resourceId: 'agent-1', name: 'Agent One' };
    mockQueryDigEmployeeRelResourceAuth.mockResolvedValue({ rows: [] });
    mockListResourceUseAuth.mockImplementation(({ ownerType }: any) => {
      if (ownerType === 'personal') {
        return Promise.resolve({
          data: {
            rows: [
              {
                id: 'personal-knowledge-1',
                name: 'Personal Knowledge From Resource Center',
                description: 'Personal Desc',
                resourceBizType: 'KG_DOC',
              },
            ],
          },
        } as any);
      }

      return Promise.resolve({
        data: {
          rows: [
            {
              id: 'enterprise-knowledge-1',
              name: 'Enterprise Knowledge From Resource Center',
              description: 'Enterprise Desc',
              resourceBizType: 'KG_DOC',
            },
          ],
        },
      } as any);
    });

    render(<Search showSearch setShowSearch={jest.fn()} />);

    await flushSearch();

    fireEvent.click(screen.getByText('个人知识').closest('[role="button"]')!);
    const personalKnowledge = await screen.findByText('Personal Knowledge From Resource Center');
    fireEvent.click(screen.getByText('企业知识').closest('[role="button"]')!);
    const enterpriseKnowledge = screen.getByText('Enterprise Knowledge From Resource Center');

    fireEvent.doubleClick(personalKnowledge);
    fireEvent.doubleClick(enterpriseKnowledge);

    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockMessageSuccess).not.toHaveBeenCalled();

    fireEvent.click(personalKnowledge);
    await act(async () => {
      jest.advanceTimersByTime(220);
      await Promise.resolve();
    });

    fireEvent.doubleClick(screen.getByTestId('knowledge-detail-node'));

    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockMessageSuccess).not.toHaveBeenCalled();
  });

  it('drills into view resource items on click like the sider list', async () => {
    mockVisibleMenuKeys = ['view'];
    mockActiveSiderAgent = { resourceId: 'agent-1', name: 'Agent One' };
    mockQueryDigEmployeeRelResourceAuth.mockResolvedValue({
      rows: [
        {
          resourceId: 'view-resource-1',
          resourceName: 'View Result',
          resourceDesc: 'View Desc',
          resourceBizType: 'VIEW',
        },
      ],
    });
    mockQueryResourceMembers.mockResolvedValue({
      extInfo: {
        targetContent: JSON.stringify({
          objects: [
            {
              resourceId: 'object-resource-1',
              resourceName: 'Object Result',
              resourceCode: 'object_code',
              resourceDesc: 'Object Desc',
            },
          ],
          fields: [
            {
              propertyCode: 'field_code',
              propertyName: 'Field Result',
            },
          ],
        }),
      },
    });

    render(<Search showSearch setShowSearch={jest.fn()} />);

    await flushSearch();

    const viewListItem = await screen.findByTestId('resource-sider-list-item-VIEW');
    expect(viewListItem).toHaveAttribute('data-drillable', 'true');

    fireEvent.click(viewListItem);

    await waitFor(() => {
      expect(mockQueryResourceMembers).toHaveBeenCalledWith({ resourceId: 'view-resource-1' });
      expect(screen.getByText('Object Result')).toBeInTheDocument();
      expect(screen.getByText('Field Result')).toBeInTheDocument();
    });
  });

  it('does not quote resource center view drill items', async () => {
    mockVisibleMenuKeys = ['view'];
    mockActiveSiderAgent = { resourceId: 'agent-1', name: 'Agent One' };
    mockQueryDigEmployeeRelResourceAuth.mockResolvedValue({ rows: [] });
    mockListResourceUseAuth.mockImplementation(({ ownerType }: any) => {
      if (ownerType === 'personal') {
        return Promise.resolve({
          data: {
            rows: [
              {
                resourceId: 'personal-view-1',
                resourceName: 'Personal View',
                resourceDesc: 'Personal View Desc',
                resourceBizType: 'VIEW',
              },
            ],
          },
        } as any);
      }

      return Promise.resolve({ data: { rows: [] } } as any);
    });
    mockQueryResourceMembers.mockResolvedValue({
      extInfo: {
        targetContent: JSON.stringify({
          objects: [
            {
              resourceId: 'object-resource-1',
              resourceName: 'Object From Personal View',
              resourceCode: 'object_code',
              resourceDesc: 'Object Desc',
            },
          ],
        }),
      },
    });

    render(<Search showSearch setShowSearch={jest.fn()} />);

    await flushSearch();

    fireEvent.click(await screen.findByText('个人视图'));
    fireEvent.click(await screen.findByText('Personal View'));

    await waitFor(() => {
      expect(mockQueryResourceMembers).toHaveBeenCalledWith({ resourceId: 'personal-view-1' });
      expect(screen.getByText('Object From Personal View')).toBeInTheDocument();
    });

    fireEvent.doubleClick(screen.getByText('Object From Personal View'));

    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockMessageSuccess).not.toHaveBeenCalled();
  });
});
