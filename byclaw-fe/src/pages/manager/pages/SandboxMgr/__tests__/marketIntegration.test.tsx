import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setMultiTenancyConfig } from '@/utils/multiTenancy';
import SandboxMgr from '../index';

const mockDispatch = jest.fn();
jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useDispatch: () => mockDispatch,
  useSelector: (select: any) => select({ user: { userInfo: { usersOrganizations: [] } } }),
}));
jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfig: jest.fn().mockResolvedValue({ paramValue: 'commercial' }),
}));
jest.mock(
  '@/pages/manager/components/ModalDrawer',
  () => (props: any) =>
    props.open ? (
      <div role="dialog" aria-label="spec-editor">
        {props.children}
        <button onClick={props.onOk}>save-spec</button>
      </div>
    ) : null
);
jest.mock('@/pages/manager/components/JsonCodeEditor', () => ({ value, onChange, id }: any) => (
  <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} />
));
jest.mock('@/pages/manager/utils/auth', () => ({ isAdminVip: () => true }));
jest.mock('@/pages/manager/service/SandboxMgr', () => ({ getPreferredServiceKey: jest.fn() }));
jest.mock('@/pages/manager/service/TenantMgr', () => ({ listTenants: jest.fn().mockResolvedValue([]) }));

const toolSpec = {
  serviceKey: 'browser-service',
  displayName: 'Browser workspace',
  ownerScope: 'USER',
  serviceType: 'browser',
  enabled: 1,
  specJson: JSON.stringify({
    image: 'browser-image',
    runtimeOptions: {
      lifecycle: { autoStart: 'true' },
      toolSandbox: {
        contract: 'byclaw.tool-sandbox/v1',
        capabilities: '["browse"]',
        description: 'Use a browser',
        enabled: 'true',
      },
    },
  }),
};

beforeEach(() => {
  mockDispatch.mockClear();
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '0' });
});

const openMarket = async () => {
  render(<SandboxMgr />);
  fireEvent.click(screen.getByRole('button', { name: /sandboxMgr.config.button/ }));
  const request = mockDispatch.mock.calls.find(([action]) => action.type === 'sandboxMgr/listServiceSpec')[0];
  act(() => request.success([toolSpec]));
  fireEvent.click(screen.getByText('sandboxMgr.dimension.TOOL'));
  await screen.findByText('Browser workspace');
};

test('the reachable market saves availability through existing CRUD and rolls back a failed update', async () => {
  await openMarket();
  fireEvent.click(screen.getByRole('switch', { name: /Browser workspace sandboxMgr.market.enabled/ }));
  const request = mockDispatch.mock.calls.find(([action]) => action.type === 'sandboxMgr/saveServiceSpec')[0];
  expect(request.payload.enabled).toBe(0);
  const config = JSON.parse(request.payload.specJson);
  expect(config.runtimeOptions.toolSandbox.enabled).toBe('false');
  expect(config.runtimeOptions.lifecycle.autoStart).toBe('true');
  act(() => request.fail());
  expect(screen.getByRole('switch', { name: /Browser workspace sandboxMgr.market.enabled/ })).toBeChecked();
});

test('editing tool metadata preserves ownership, runtime options and the independent login startup value', async () => {
  await openMarket();
  fireEvent.click(screen.getByRole('button', { name: /sandboxMgr.market.edit/ }));
  const editor = screen.getByRole('dialog', { name: 'spec-editor' });
  expect(within(editor).queryByText('sandboxMgr.config.autoStart')).not.toBeInTheDocument();
  fireEvent.change(within(editor).getByLabelText('sandboxMgr.market.description'), {
    target: { value: 'Updated browser capability' },
  });
  fireEvent.click(within(editor).getByRole('button', { name: 'save-spec' }));
  await waitFor(() =>
    expect(mockDispatch.mock.calls.some(([action]) => action.type === 'sandboxMgr/saveServiceSpec')).toBe(true)
  );
  const request = mockDispatch.mock.calls.find(([action]) => action.type === 'sandboxMgr/saveServiceSpec')[0];
  expect(request.payload.ownerScope).toBe('USER');
  expect(request.payload.serviceType).toBe('browser');
  expect(JSON.parse(request.payload.specJson)).toEqual({
    image: 'browser-image',
    runtimeOptions: {
      lifecycle: { autoStart: 'true' },
      toolSandbox: {
        contract: 'byclaw.tool-sandbox/v1',
        capabilities: '["browse"]',
        description: 'Updated browser capability',
        enabled: 'true',
        coverImage: '',
      },
    },
  });
});

test('the manager keeps four ownership tabs reachable and applies login startup only to user specifications', async () => {
  render(<SandboxMgr />);
  fireEvent.click(screen.getByRole('button', { name: /sandboxMgr.config.button/ }));
  const request = mockDispatch.mock.calls.find(([action]) => action.type === 'sandboxMgr/listServiceSpec')[0];
  const records = [
    { serviceKey: 'personal-runtime', ownerScope: 'USER', enabled: 1, specJson: '{}' },
    { serviceKey: 'tenant-runtime', ownerScope: 'TENANT', enabled: 1, specJson: '{}' },
    { serviceKey: 'shared-runtime', ownerScope: 'SHARED', enabled: 1, specJson: '{}' },
    toolSpec,
  ];
  act(() => request.success(records));

  for (const dimension of ['USER', 'TENANT', 'SHARED', 'TOOL']) {
    expect(screen.getByRole('tab', { name: new RegExp(`sandboxMgr.dimension.${dimension}`) })).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole('switch', { name: 'personal-runtime sandboxMgr.config.autoStart' }));
  const autoStartRequest = mockDispatch.mock.calls.find(([action]) => action.type === 'sandboxMgr/saveServiceSpec')[0];
  expect(autoStartRequest.payload.enabled).toBe(1);
  expect(JSON.parse(autoStartRequest.payload.specJson).runtimeOptions.lifecycle.autoStart).toBe('false');
  act(() => autoStartRequest.success());

  for (const [dimension, serviceKey] of [
    ['TENANT', 'tenant-runtime'],
    ['SHARED', 'shared-runtime'],
  ]) {
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(`sandboxMgr.dimension.${dimension}`) }));
    expect(screen.queryByRole('switch', { name: /sandboxMgr.config.autoStart/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: `${serviceKey} sandboxMgr.market.enabled` }));
    const updates = mockDispatch.mock.calls.filter(([action]) => action.type === 'sandboxMgr/saveServiceSpec');
    const update = updates[updates.length - 1][0];
    expect(update.payload).toEqual(expect.objectContaining({ serviceKey, ownerScope: dimension, enabled: 0 }));
    expect(JSON.parse(update.payload.specJson)).toEqual({});
    act(() => update.success());
  }

  fireEvent.click(screen.getByRole('tab', { name: /sandboxMgr.dimension.TOOL/ }));
  expect(screen.getByText('Browser workspace')).toBeInTheDocument();
  expect(screen.queryByRole('switch', { name: /sandboxMgr.config.autoStart/ })).not.toBeInTheDocument();
  expect(screen.queryByText('personal-runtime')).not.toBeInTheDocument();
  expect(screen.queryByText('tenant-runtime')).not.toBeInTheDocument();
  expect(screen.queryByText('shared-runtime')).not.toBeInTheDocument();
});

test('profile administration requests all service types including disabled resource profiles', () => {
  render(<SandboxMgr />);
  fireEvent.click(screen.getByRole('button', { name: /sandboxMgr.config.button/ }));
  const request = mockDispatch.mock.calls.find(([action]) => action.type === 'sandboxMgr/listServiceProfiles')[0];
  expect(request.payload).toEqual({ allServiceTypes: true, enabledOnly: false });
});
