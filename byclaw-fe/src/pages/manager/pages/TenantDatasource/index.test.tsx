import { fireEvent, render as renderComponent, screen, waitFor } from '@testing-library/react';
import { ConfigProvider, Modal } from 'antd';
import TenantDatasource from './index';
import { listTenants } from '../../service/TenantMgr';
import { browseTenantTable, executeTenantSql, listTenantTables } from '../../service/TenantDatasource';

let mockLocale = 'zh-CN';

jest.mock('@umijs/max', () => ({
  useIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ user: { userInfo: { usersOrganizations: [{ userType: 'PLAT_MAN' }] } } }),
}));

jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  return {
    ...actual,
    Select: ({
      value,
      onChange,
      options,
    }: {
      value?: string;
      onChange: (value: string) => void;
      options: { label: string; value: string }[];
    }) => (
      <select aria-label="选择租户" value={value || ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">选择租户</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
});

jest.mock('../../service/TenantMgr', () => ({ listTenants: jest.fn() }));
jest.mock('../../service/TenantDatasource', () => ({
  browseTenantTable: jest.fn(),
  executeTenantSql: jest.fn(),
  listTenantTables: jest.fn(),
}));

const result = (page = 1, hasNextPage = false) => ({
  columns: [{ name: 'value', type: 'integer' }],
  rows: [['1']],
  affectedRows: 0,
  page,
  pageSize: 500,
  hasNextPage,
  truncated: false,
});

// 保留对象树、页签和数据表交互，关闭动画以避免切换更新跨越用例边界。
const render = (ui: Parameters<typeof renderComponent>[0]) =>
  renderComponent(ui, {
    wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>,
  });

async function connectTenant() {
  render(<TenantDatasource />);
  await screen.findByRole('option', { name: '测试租户 · 123' });
  fireEvent.change(screen.getByRole('combobox', { name: '选择租户' }), { target: { value: '123' } });
  await waitFor(() => expect(listTenantTables).toHaveBeenCalledWith('123'));
  await screen.findByRole('treeitem', { name: /sample/ });
}

describe('tenant datasource workbench', () => {
  // 每个用例覆盖连接和多步交互，单步等待仍保留默认预算。
  jest.setTimeout(15000);
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocale = 'zh-CN';
    (listTenants as jest.Mock).mockResolvedValue([
      { enterpriseId: '123', enterpriseName: '测试租户', provisionState: 'READY' },
    ]);
    (listTenantTables as jest.Mock).mockResolvedValue([{ schema: 'byai', name: 'sample', type: 'BASE TABLE' }]);
    (browseTenantTable as jest.Mock).mockResolvedValue(result());
    (executeTenantSql as jest.Mock).mockResolvedValue(result(1, true));
  });

  it('switches the existing workspace to English without changing the selected tenant or SQL', async () => {
    const { rerender } = render(<TenantDatasource />);
    await screen.findByRole('option', { name: '测试租户 · 123' });
    fireEvent.change(screen.getByRole('combobox', { name: '选择租户' }), { target: { value: '123' } });
    await screen.findByRole('treeitem', { name: /sample/ });
    fireEvent.change(screen.getByPlaceholderText('输入一条 SQL 语句…'), { target: { value: 'SELECT 1' } });
    mockLocale = 'en-US';
    rerender(<TenantDatasource />);
    expect(screen.getByPlaceholderText('Enter one SQL statement…')).toHaveValue('SELECT 1');
    expect(screen.getByRole('tree', { name: 'Tenant database objects' })).toBeInTheDocument();
    // Ant Design 图标的名称也会进入按钮的可访问名称，与中文用例采用相同匹配方式。
    fireEvent.click(screen.getByRole('button', { name: /Run SQL/ }));
    await waitFor(() => expect(executeTenantSql).toHaveBeenCalledWith('123', 'SELECT 1', 1, false));
    expect(await screen.findByText(/^Page 1 · 1 rows(?: · \d+ ms)?$/)).toBeInTheDocument();
    expect(screen.getByText('Up to 500 rows per page')).toBeInTheDocument();
  });

  it('selects a table on single click and opens a closable data tab on double click', async () => {
    await connectTenant();
    const table = screen.getByRole('treeitem', { name: /sample/ });
    fireEvent.click(table);
    expect(browseTenantTable).not.toHaveBeenCalled();
    expect(table).toHaveAttribute('aria-selected', 'true');

    fireEvent.doubleClick(table);
    await waitFor(() => expect(browseTenantTable).toHaveBeenCalledWith('123', 'byai', 'sample', 1));
    expect(screen.getByRole('tab', { name: /sample/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: '关闭 sample' }));
    expect(screen.queryByRole('tab', { name: /sample/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /SQL 查询/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('requests the next SQL result page from the server', async () => {
    await connectTenant();
    fireEvent.change(await screen.findByPlaceholderText('输入一条 SQL 语句…'), {
      target: { value: 'SELECT generate_series(1, 1001)' },
    });
    fireEvent.click(screen.getByRole('button', { name: /运行 SQL/ }));
    await waitFor(() =>
      expect(executeTenantSql).toHaveBeenCalledWith('123', 'SELECT generate_series(1, 1001)', 1, false)
    );
    fireEvent.click(await screen.findByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(executeTenantSql).toHaveBeenCalledWith('123', 'SELECT generate_series(1, 1001)', 2, false)
    );
  });

  it('asks for confirmation before sending a destructive statement', async () => {
    await connectTenant();
    const confirm = jest.spyOn(Modal, 'confirm').mockImplementation(jest.fn());
    fireEvent.change(await screen.findByPlaceholderText('输入一条 SQL 语句…'), {
      target: { value: 'DROP TABLE byai.sample' },
    });
    fireEvent.click(screen.getByRole('button', { name: /运行 SQL/ }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '确认执行高危 SQL？' }));
    expect(executeTenantSql).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
