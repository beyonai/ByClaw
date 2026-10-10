import { act, cleanup, fireEvent, render as renderComponent, screen, within } from '@testing-library/react';
import { ConfigProvider, message } from 'antd';
import ApprovalCenter from '..';
import useEmployeePublicationCapabilities from '@/hooks/useEmployeePublicationCapabilities';
import { approveUseApply, queryResourceUseApplyAudit } from '@/pages/manager/service/resources';

jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  return {
    ...actual,
    // 保留真实确认操作，去掉弹层准备动画，避免确认按钮延迟挂载。
    Popconfirm: (props: import('antd').PopconfirmProps) => <actual.Popconfirm {...props} transitionName="" />,
    // 入口测试保留真实列内容和审核操作，仅省去固定列、滚动区域的布局计算。
    Table: ({ dataSource = [], columns = [], rowKey }: any) => (
      <table>
        <tbody>
          {dataSource.map((row: any, index: number) => (
            <tr key={typeof rowKey === 'function' ? rowKey(row) : index}>
              {columns.map((column: any, columnIndex: number) => {
                const value = row[column.dataIndex];
                return (
                  <td key={column.key ?? columnIndex}>{column.render ? column.render(value, row, index) : value}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    ),
  };
});

const mockRefresh = jest.fn();
jest.mock('@/hooks/useApprovalPendingCounts', () => ({
  __esModule: true,
  default: () => ({ counts: { employee: 2, skill: 1, knowledge: 3, tool: 4 }, refresh: mockRefresh }),
}));
jest.mock('@/hooks/useEmployeePublicationCapabilities');
jest.mock('@umijs/max', () => {
  const { useState } = require('react');
  const intl = { formatMessage: ({ id }: { id: string }) => id };
  return {
    useIntl: () => intl,
    useSearchParams: () => {
      const [query, setQuery] = useState(globalThis.window.location.search);
      return [
        new URLSearchParams(query),
        (next: URLSearchParams) => {
          globalThis.window.history.replaceState({}, '', `?${next}`);
          setQuery(`?${next}`);
        },
      ];
    },
  };
});
jest.mock('@/pages/manager/service/resources', () => ({
  queryResourceUseApplyAudit: jest.fn(),
  approveUseApply: jest.fn().mockResolvedValue(undefined),
  rejectUseApply: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/components/EmployeePublication/AuditList', () => ({
  __esModule: true,
  default: ({ onAuditComplete, initialReview, toolbarExtra }: any) => (
    <div>
      <div data-testid="publication-toolbar">{toolbarExtra}</div>
      <button type="button" data-review={String(initialReview)} onClick={onAuditComplete}>
        publication approval
      </button>
    </div>
  ),
}));

const types = ['DIG_EMPLOYEE', 'SKILL', 'KG_DOC', 'KG_QA', 'KG_TERM', 'MCP', 'TOOLKIT', 'AGENT'];

// 等待已 mock 的审批请求和状态更新完成，再检查页签与列表，避免未完成的更新进入下个用例。
const render = async (ui: Parameters<typeof renderComponent>[0]) => {
  await act(async () => {
    renderComponent(ui, {
      wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>,
    });
  });
};

describe('approval center', () => {
  // 类型隔离用例包含多次审核视图更新，仅限制用例总预算。
  jest.setTimeout(15000);

  // 三类知识/工具同时检查待审和历史，沿用已有总预算。
  const typeIsolationTestTimeout = 30000;

  beforeEach(() => {
    jest.clearAllMocks();
    // 入口测试检查审核结果及计数回调，提示内容另行断言，省去全局消息根的渲染和计时器。
    jest.spyOn(message, 'success').mockImplementation(jest.fn());
    window.history.replaceState({}, '', '/approvalCenter');
    (useEmployeePublicationCapabilities as jest.Mock).mockReturnValue({ enabled: true, administrator: true });
    // 故意混入所有业务类型，验证入口切换和表格的二次隔离规则。
    (queryResourceUseApplyAudit as jest.Mock).mockImplementation(({ history }: { history: boolean }) =>
      Promise.resolve({
        data: types.map((type) => ({
          resourceId: type,
          resourceBizType: type,
          resourceName: `${history ? 'history' : 'pending'}-${type}`,
          privilegeGrantId: `grant-${type}`,
          userId: 'applicant',
          userName: '申请人',
          applyStatus: history ? 'X' : 'P',
          auditUserName: '审核人',
          auditTime: '2026-10-08 10:00:00',
        })),
      })
    );
  });

  afterEach(async () => {
    cleanup();
    // 审核提示挂在 render 容器之外，清理提示和计时器，避免状态更新跨越用例边界。
    await act(async () => {
      message.destroy();
    });
    jest.restoreAllMocks();
  });

  it.each([
    ['employee', ['DIG_EMPLOYEE']],
    ['skill', ['SKILL']],
    ['knowledge', ['KG_DOC', 'KG_QA', 'KG_TERM']],
    ['tool', ['MCP', 'TOOLKIT', 'AGENT']],
  ])(
    'opens %s directly and isolates pending and history rows',
    async (tab, allowedTypes) => {
      window.history.replaceState({}, '', `/approvalCenter?tab=${tab}`);
      await render(<ApprovalCenter />);
      // 本用例检查角色、名称和类型隔离，跳过 JSDOM 的 CSS 可见性计算；仍保留真实页签。
      const tabs = within(screen.getByRole('tablist', { hidden: true }));
      for (const name of ['employee', 'skill', 'knowledge', 'tool']) {
        expect(tabs.getByRole('tab', { name: new RegExp(`approvalCenter.${name}`), hidden: true })).toBeInTheDocument();
      }
      expect(tabs.getByRole('tab', { name: new RegExp(`approvalCenter.${tab}`), hidden: true })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      for (const history of [false, true]) {
        if (history) {
          await act(async () => {
            fireEvent.click(screen.getByText('resourceCenter.reviewHistory'));
          });
        }
        const prefix = history ? 'history' : 'pending';
        expect(screen.getByText(`${prefix}-${allowedTypes[0]}`)).toBeInTheDocument();
        // 一次收集全部资源名，完整比较允许类型，并检查其他类型和上一视图均未残留。
        expect(
          screen
            .getAllByText(/^(pending|history)-/)
            .map((element) => element.textContent)
            .sort()
        ).toEqual(allowedTypes.map((type) => `${prefix}-${type}`).sort());
        expect(queryResourceUseApplyAudit).toHaveBeenCalledWith({ history, resourceBizTypeList: allowedTypes });
      }
    },
    typeIsolationTestTimeout
  );

  it('removes an approved row and refreshes the shared pending counts', async () => {
    window.history.replaceState({}, '', '/approvalCenter?tab=skill');
    await render(<ApprovalCenter />);
    const row = screen.getByText('pending-SKILL').closest('tr')!;
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'resourceCenter.approve', hidden: true }));
    });
    const confirmation = (await screen.findByText('resourceCenter.confirmApprove')).closest('.ant-popover')!;
    await act(async () => {
      fireEvent.click(within(confirmation).getByRole('button', { name: 'common.confirm', hidden: true }));
    });
    expect(screen.queryByText('pending-SKILL')).not.toBeInTheDocument();
    expect(approveUseApply).toHaveBeenCalledWith({ resourceId: 'SKILL', applyUserId: 'applicant' });
    expect(message.success).toHaveBeenCalledWith('resourceCenter.approve');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('clears the prior history view when switching resource types', async () => {
    await render(<ApprovalCenter />);
    expect(screen.getByText('pending-DIG_EMPLOYEE')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('resourceCenter.reviewHistory'));
    });
    expect(screen.getByText('history-DIG_EMPLOYEE')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /approvalCenter.skill/, hidden: true }));
    });
    expect(screen.getByText('pending-SKILL')).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=skill');
    expect(screen.queryByText('history-DIG_EMPLOYEE')).not.toBeInTheDocument();
  });

  it('keeps employee publication approvals in the employee tab and refreshes their count', async () => {
    await render(<ApprovalCenter />);
    fireEvent.click(screen.getByText('approvalCenter.employeePublication'));
    const publication = screen.getByRole('button', { name: 'publication approval', hidden: true });
    expect(publication).toHaveAttribute('data-review', 'true');
    fireEvent.click(publication);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  // 此用例切换三次审核视图，与类型隔离用例共用总预算。
  it(
    'places employee approval kinds at the right of the tab bar and keeps switching available in publication mode',
    async () => {
      await render(<ApprovalCenter />);
      expect(screen.getByText('pending-DIG_EMPLOYEE')).toBeInTheDocument();
      const tabs = within(screen.getByRole('tablist', { hidden: true }));
      const search = screen.getByPlaceholderText('myEmployees.searchPlaceholder');
      const searchControl = search.closest('.ant-input-affix-wrapper')!;
      const kinds = screen.getByText('approvalCenter.employeeUse').closest('.ant-segmented')!;
      const status = screen.getByText('resourceCenter.unreviewed').closest('.ant-segmented')!;
      const tabBar = tabs.getByRole('tab', { name: /approvalCenter.employee/, hidden: true }).closest('.ant-tabs-nav')!;
      const extra = kinds.closest('.ant-tabs-extra-content')!;
      // 使用 Tabs 的右侧扩展区域，将类型切换与页签放在同一行，并移出搜索工具栏。
      expect(tabBar).toContainElement(kinds);
      expect(tabBar.lastElementChild).toBe(extra);
      expect(searchControl.parentElement).not.toContainElement(kinds);
      expect(searchControl.nextElementSibling).toBe(status);

      await act(async () => {
        fireEvent.click(screen.getByText('approvalCenter.employeePublication'));
      });
      expect(tabBar).toContainElement(screen.getByText('approvalCenter.employeeUse'));
      expect(screen.getByTestId('publication-toolbar')).not.toContainElement(
        screen.getByText('approvalCenter.employeeUse')
      );
      await act(async () => {
        fireEvent.click(screen.getByText('approvalCenter.employeeUse'));
      });
      expect(screen.getByText('pending-DIG_EMPLOYEE')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('myEmployees.searchPlaceholder')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'publication approval', hidden: true })).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(tabs.getByRole('tab', { name: /approvalCenter.skill/, hidden: true }));
      });
      expect(screen.getByText('pending-SKILL')).toBeInTheDocument();
      expect(screen.queryByText('approvalCenter.employeeUse')).not.toBeInTheDocument();
      expect(screen.queryByText('approvalCenter.employeePublication')).not.toBeInTheDocument();
    },
    typeIsolationTestTimeout
  );

  it('defaults unknown tabs to employees and respects disabled publication capabilities', async () => {
    window.history.replaceState({}, '', '/approvalCenter?tab=unknown');
    (useEmployeePublicationCapabilities as jest.Mock).mockReturnValue({ enabled: false });
    await render(<ApprovalCenter />);
    expect(screen.getByText('pending-DIG_EMPLOYEE')).toBeInTheDocument();
    expect(screen.queryByText('approvalCenter.employeePublication')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'publication approval', hidden: true })).not.toBeInTheDocument();
  });
});
