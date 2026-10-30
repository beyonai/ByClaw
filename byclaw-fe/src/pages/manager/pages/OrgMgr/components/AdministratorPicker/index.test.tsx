import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import AdministratorPicker from '.';
import { getAdministratorCandidates, getAdministratorOrganizations } from '@/service/orgMgr';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) => {
      const messages = require('@/locales/zh-CN/manager').default;
      return (messages[id] || id).replace('{count}', String(values?.count ?? ''));
    },
  }),
}));
jest.mock('@/service/orgMgr', () => ({
  getAdministratorOrganizations: jest.fn(),
  getAdministratorCandidates: jest.fn(),
}));

const organizations = [
  { orgId: 10, parentOrgId: -1, orgName: '研发部' },
  { orgId: 11, parentOrgId: 10, orgName: '研发子部' },
  { orgId: 12, parentOrgId: -1, orgName: '市场部' },
];
const member = (userId: string, userName: string) => ({ userId, userName, administrator: false });
const mockOrganizations = getAdministratorOrganizations as jest.Mock;
const mockCandidates = getAdministratorCandidates as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockOrganizations.mockResolvedValue(organizations);
  mockCandidates.mockImplementation((_context, orgId) => {
    if (orgId === '10') return Promise.resolve([member('8', '张甲'), member('9', '李乙')]);
    if (orgId === '11') return Promise.resolve([member('10', '子组织用户')]);
    return Promise.resolve([member('11', '市场用户')]);
  });
});

const renderPicker = (props: Record<string, unknown> = {}) =>
  render(
    <ConfigProvider locale={zhCN}>
      <AdministratorPicker initialMembers={[]} parentOrgId={10} {...props} />
    </ConfigProvider>
  );
const openPicker = async () => {
  fireEvent.mouseDown(screen.getByRole('combobox'));
  return screen.findByRole('dialog', { name: '选择组织管理员' });
};

it('selects multiple direct members across organizations and commits only on confirmation', async () => {
  const onChange = jest.fn();
  renderPicker({ onChange });
  const dialog = within(await openPicker());
  await dialog.findByRole('checkbox', { name: '张甲' });
  expect(dialog.queryByRole('checkbox', { name: '子组织用户' })).not.toBeInTheDocument();
  expect(mockCandidates).toHaveBeenCalledWith({ orgId: undefined, parentOrgId: 10 }, '10');
  fireEvent.click(dialog.getByRole('checkbox', { name: '张甲' }));
  fireEvent.click(dialog.getByRole('checkbox', { name: '李乙' }));
  fireEvent.click(dialog.getByText('市场部'));
  fireEvent.click(await dialog.findByRole('checkbox', { name: '市场用户' }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: /确.*定/ }));
  expect(onChange).toHaveBeenCalledWith(['8', '9', '11']);
});

it('preserves existing selections when canceled and searches only the selected organization', async () => {
  const onChange = jest.fn();
  renderPicker({ value: ['8'], initialMembers: [member('8', '张甲')], onChange });
  const dialog = within(await openPicker());
  expect(await dialog.findByRole('checkbox', { name: '张甲' })).toBeChecked();
  fireEvent.change(dialog.getByPlaceholderText('搜索当前组织的用户'), { target: { value: '李乙' } });
  expect(dialog.queryByRole('checkbox', { name: '张甲' })).not.toBeInTheDocument();
  expect(dialog.getByRole('checkbox', { name: '李乙' })).toBeInTheDocument();
  fireEvent.click(dialog.getByRole('checkbox', { name: '李乙' }));
  fireEvent.click(dialog.getByRole('button', { name: /取.*消/ }));
  expect(onChange).not.toHaveBeenCalled();
});

it('blocks confirmation on load failure and allows retry without clearing selections', async () => {
  mockCandidates.mockRejectedValueOnce('管理员列表暂时不可用');
  const onChange = jest.fn();
  renderPicker({ value: ['8'], initialMembers: [member('8', '张甲')], onChange });
  const dialog = within(await openPicker());
  await dialog.findByText('管理员列表暂时不可用');
  expect(dialog.getByRole('button', { name: /确.*定/ })).toBeDisabled();
  fireEvent.click(dialog.getByRole('button', { name: /重\s*试/ }));
  await dialog.findByRole('checkbox', { name: '张甲' });
  await waitFor(() => expect(dialog.getByRole('button', { name: /确.*定/ })).toBeEnabled());
  fireEvent.click(dialog.getByRole('button', { name: /确.*定/ }));
  expect(onChange).toHaveBeenCalledWith(['8']);
});

it('ignores a late response from the previously selected organization', async () => {
  let resolveOld!: (value: unknown) => void;
  mockCandidates.mockImplementation((_context, orgId) => {
    if (orgId !== '10') return Promise.resolve([member('11', '市场用户')]);
    return new Promise((resolve) => {
      resolveOld = resolve;
    });
  });
  renderPicker();
  const dialog = within(await openPicker());
  await waitFor(() => expect(mockCandidates).toHaveBeenCalled());
  fireEvent.click(dialog.getByText('市场部'));
  await dialog.findByRole('checkbox', { name: '市场用户' });
  await act(async () => {
    resolveOld([member('8', '过期用户')]);
  });
  expect(dialog.queryByRole('checkbox', { name: '过期用户' })).not.toBeInTheDocument();
  expect(dialog.getByRole('checkbox', { name: '市场用户' })).toBeInTheDocument();
});
