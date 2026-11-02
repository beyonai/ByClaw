import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import OrganizationInfoModal from '.';
import {
  getOrganizationAdministrators,
  getAdministratorOrganizations,
  getAdministratorCandidates,
} from '@/service/orgMgr';

jest.mock('dva', () => ({ connect: () => (component: unknown) => component }));
jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => require('@/locales/zh-CN/manager').default[id] || id }),
}));
jest.mock('@/service/orgMgr', () => ({
  getOrganizationAdministrators: jest.fn(),
  getAdministratorOrganizations: jest.fn(),
  getAdministratorCandidates: jest.fn(),
}));
const admin = { userId: '8', userName: '管理员甲', administrator: true };
const organizations = [{ orgId: 10, parentOrgId: -1, orgName: '研发部' }];

beforeEach(() => {
  jest.clearAllMocks();
  (getOrganizationAdministrators as jest.Mock).mockResolvedValue([admin]);
  (getAdministratorOrganizations as jest.Mock).mockResolvedValue(organizations);
  (getAdministratorCandidates as jest.Mock).mockResolvedValue([
    admin,
    { userId: '9', userName: '管理员乙', administrator: false },
  ]);
});

function setup(type: string, record: Record<string, unknown>) {
  const dispatch = jest.fn((action) => {
    if (action.type === 'orgMgr/getOrgTree') action.success({ data: organizations });
    return Promise.resolve();
  });
  render(
    <ConfigProvider locale={zhCN}>
      <OrganizationInfoModal
        visible
        type={type}
        record={record}
        dispatch={dispatch}
        onCancel={jest.fn()}
        onOk={jest.fn()}
      />
    </ConfigProvider>
  );
  return dispatch;
}

it('creates an organization with multiple selected administrators in one request', async () => {
  const dispatch = setup('add', { parentOrgId: 10 });
  const form = within(screen.getByRole('dialog', { name: '新增组织信息' }));
  fireEvent.change(form.getByLabelText('组织名称'), { target: { value: '新组织' } });
  fireEvent.change(form.getByLabelText('组织编码'), { target: { value: 'new_org' } });
  fireEvent.mouseDown(form.getByLabelText('组织管理员'));
  // rc-dialog uses the same generated title ID for all modals in test mode.
  const pickerTitle = await screen.findByText('选择组织管理员', { selector: '[id]' });
  const picker = within(pickerTitle.closest('[role="dialog"]') as HTMLElement);
  fireEvent.click(await picker.findByRole('checkbox', { name: '管理员甲' }));
  fireEvent.click(picker.getByRole('checkbox', { name: '管理员乙' }));
  fireEvent.click(picker.getByRole('button', { name: /确.*定/ }));
  fireEvent.click(form.getByRole('button', { name: /确.*定/ }));
  await waitFor(() =>
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'orgMgr/addOrg',
        payload: expect.objectContaining({ administratorIds: ['8', '9'], parentOrgId: 10, orgCode: 'new_org' }),
      })
    )
  );
  expect(getOrganizationAdministrators).not.toHaveBeenCalled();
});

it('keeps editing disabled after administrator load failure and preserves roles after retry', async () => {
  (getOrganizationAdministrators as jest.Mock).mockRejectedValueOnce('组织管理员加载失败');
  const dispatch = setup('edit', {
    orgId: 20,
    parentOrgId: 10,
    orgName: '研发部',
    orgCode: 'dev',
    administratorIds: ['8'],
  });
  const form = within(screen.getByRole('dialog', { name: '编辑组织信息' }));
  await form.findByText('组织管理员加载失败');
  expect(form.getByRole('button', { name: /确.*定/ })).toBeDisabled();
  fireEvent.click(form.getByRole('button', { name: /重\s*试/ }));
  await waitFor(() => expect(form.getByRole('button', { name: /确.*定/ })).toBeEnabled());
  fireEvent.click(form.getByRole('button', { name: /确.*定/ }));
  await waitFor(() =>
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'orgMgr/updateOrg',
        payload: expect.objectContaining({ administratorIds: ['8'] }),
      })
    )
  );
});
