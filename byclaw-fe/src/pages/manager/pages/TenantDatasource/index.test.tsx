import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Modal } from 'antd';
import TenantDatasource from './index';
import { listTenants } from '../../service/TenantMgr';
import { browseTenantTable, executeTenantSql, listTenantTables } from '../../service/TenantDatasource';

jest.mock('@umijs/max', () => ({
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

async function connectTenant() {
  render(<TenantDatasource />);
  await screen.findByRole('option', { name: '测试租户 · 123' });
  fireEvent.change(screen.getByRole('combobox', { name: '选择租户' }), { target: { value: '123' } });
  await waitFor(() => expect(listTenantTables).toHaveBeenCalledWith('123'));
  await screen.findByRole('treeitem', { name: /sample/ });
}

describe('tenant datasource workbench', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listTenants as jest.Mock).mockResolvedValue([
      { enterpriseId: '123', enterpriseName: '测试租户', provisionState: 'READY' },
    ]);
    (listTenantTables as jest.Mock).mockResolvedValue([{ schema: 'byai', name: 'sample', type: 'BASE TABLE' }]);
    (browseTenantTable as jest.Mock).mockResolvedValue(result());
    (executeTenantSql as jest.Mock).mockResolvedValue(result(1, true));
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
    fireEvent.change(screen.getByPlaceholderText('输入一条 SQL 语句…'), {
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
    fireEvent.change(screen.getByPlaceholderText('输入一条 SQL 语句…'), {
      target: { value: 'DROP TABLE byai.sample' },
    });
    fireEvent.click(screen.getByRole('button', { name: /运行 SQL/ }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '确认执行高危 SQL？' }));
    expect(executeTenantSql).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
