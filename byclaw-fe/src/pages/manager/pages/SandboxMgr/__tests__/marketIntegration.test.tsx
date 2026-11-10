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

function getVisibleButton(label: string) {
  // 大型管理页含多个弹层，按精确文案缩小范围后仍校验真实按钮可见性。
  const button = screen.getByText(label).closest('button');
  expect(button).toBeVisible();
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

const openMarket = async () => {
  render(<SandboxMgr />);
  fireEvent.click(getVisibleButton('sandboxMgr.config.button'));
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
  fireEvent.click(getVisibleButton('sandboxMgr.market.edit'));
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

test('persists raw tool metadata edits together with changed form fields and refreshes the card', async () => {
  await openMarket();
  fireEvent.click(getVisibleButton('sandboxMgr.market.edit'));
  const editor = screen.getByRole('dialog', { name: 'spec-editor' });
  const spec = JSON.parse(toolSpec.specJson);
  spec.runtimeOptions.toolSandbox.description = 'Saved from Spec JSON';
  spec.runtimeOptions.toolSandbox.capabilities = ['process.exec'];
  spec.runtimeOptions.toolSandbox.coverImage = 'https://example.com/raw.png';
  fireEvent.change(within(editor).getByLabelText('sandboxMgr.config.specJson'), {
    target: { value: JSON.stringify(spec) },
  });
  fireEvent.change(within(editor).getByLabelText('sandboxMgr.market.coverUrl'), {
    target: { value: 'https://example.com/cover.png?version=2' },
  });
  fireEvent.click(within(editor).getByRole('button', { name: 'save-spec' }));

  await waitFor(() =>
    expect(mockDispatch.mock.calls.some(([action]) => action.type === 'sandboxMgr/saveServiceSpec')).toBe(true)
  );
  const { payload, success } = mockDispatch.mock.calls.find(
    ([action]) => action.type === 'sandboxMgr/saveServiceSpec'
  )[0];
  expect(JSON.parse(payload.specJson).runtimeOptions.toolSandbox).toEqual({
    ...spec.runtimeOptions.toolSandbox,
    capabilities: '["process.exec"]',
    coverImage: 'https://example.com/cover.png?version=2',
  });
  act(() => success());
  const reloads = mockDispatch.mock.calls.filter(([action]) => action.type === 'sandboxMgr/listServiceSpec');
  expect(reloads).toHaveLength(2);
  act(() => reloads[1][0].success([payload]));
  expect(await screen.findByText('Saved from Spec JSON')).toBeVisible();
  expect(screen.getByText('Browser workspace').closest('article')?.querySelector('img')).toHaveAttribute(
    'src',
    'https://example.com/cover.png?version=2'
  );
});

test('waits for the local cover file before saving its data URL', async () => {
  await openMarket();
  fireEvent.click(getVisibleButton('sandboxMgr.market.edit'));
  const editor = screen.getByRole('dialog', { name: 'spec-editor' });
  let reader: FileReader | undefined;
  const readFile = jest.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
    reader = this;
  });
  try {
    fireEvent.change(editor.querySelector('input[type="file"]')!, {
      target: { files: [new File(['new cover'], 'cover.png', { type: 'image/png' })] },
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'save-spec' }));
    await act(async () => {});
    expect(mockDispatch.mock.calls.some(([action]) => action.type === 'sandboxMgr/saveServiceSpec')).toBe(false);
    if (!reader) throw new Error('Expected a pending file read');
    Object.defineProperty(reader, 'result', { value: 'data:image/png;base64,bmV3IGNvdmVy' });
    act(() => {
      reader?.dispatchEvent(new Event('load'));
      reader?.dispatchEvent(new Event('loadend'));
    });
    expect(screen.getByRole('img', { name: 'sandboxMgr.market.cover' })).toBeVisible();
  } finally {
    readFile.mockRestore();
  }

  fireEvent.click(within(editor).getByRole('button', { name: 'save-spec' }));
  await waitFor(() =>
    expect(mockDispatch.mock.calls.some(([action]) => action.type === 'sandboxMgr/saveServiceSpec')).toBe(true)
  );
  const { payload } = mockDispatch.mock.calls.find(([action]) => action.type === 'sandboxMgr/saveServiceSpec')[0];
  expect(JSON.parse(payload.specJson).runtimeOptions.toolSandbox.coverImage).toBe('data:image/png;base64,bmV3IGNvdmVy');
});

test('the manager keeps four ownership tabs reachable and applies login startup only to user specifications', async () => {
  render(<SandboxMgr />);
  fireEvent.click(getVisibleButton('sandboxMgr.config.button'));
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

test('configuration loads profiles and health only when their tabs are first opened', () => {
  render(<SandboxMgr />);
  fireEvent.click(getVisibleButton('sandboxMgr.config.button'));
  const calls = (type: string) => mockDispatch.mock.calls.filter(([action]) => action.type === type);
  const profiles = 'sandboxMgr/listServiceProfiles';
  const health = 'sandboxMgr/getSandboxHealthGlobalSwitch';
  const watermarks = 'sandboxMgr/listSandboxHealthWatermarkModels';
  expect(calls('sandboxMgr/listServiceSpec')).toHaveLength(1);
  expect(calls(profiles)).toHaveLength(0);
  expect(calls(health)).toHaveLength(0);
  expect(calls(watermarks)).toHaveLength(0);

  fireEvent.click(screen.getByRole('tab', { name: 'sandboxMgr.config.tab.profile' }));
  expect(calls(profiles)[0][0].payload).toEqual({ allServiceTypes: true, enabledOnly: false });
  fireEvent.click(screen.getByRole('tab', { name: 'sandboxMgr.config.tab.health' }));
  expect(calls(health)).toHaveLength(1);
  expect(calls(watermarks)).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', { name: 'sandboxMgr.config.tab.profile' }));
  expect(calls(profiles)).toHaveLength(1);
});

test('the general execution sandbox can be explicitly admitted to the market from its legacy user category', async () => {
  render(<SandboxMgr />);
  fireEvent.click(getVisibleButton('sandboxMgr.config.button'));
  const request = mockDispatch.mock.calls.find(([action]) => action.type === 'sandboxMgr/listServiceSpec')[0];
  const original = {
    serviceKey: 'byclaw-dsh-tools',
    displayName: 'Legacy general tools',
    serviceType: 'private-existing-profile-type',
    ownerScope: 'USER',
    enabled: 1,
    specJson: JSON.stringify({
      image: 'keep-tools-image',
      env: { PRIVATE_TOKEN: 'keep-fixture' },
      startup: { entrypoint: ['keep-entrypoint', 'tools'] },
    }),
  };
  act(() => request.success([original]));
  fireEvent.click(screen.getByText('sandboxMgr.dimension.USER'));
  await screen.findByText('byclaw-dsh-tools');
  fireEvent.click(getVisibleButton('sandboxMgr.market.edit'));
  const editor = screen.getByRole('dialog', { name: 'spec-editor' });
  expect(within(editor).getByText('sandboxMgr.market.presetResources')).toBeVisible();
  fireEvent.click(within(editor).getByRole('button', { name: 'sandboxMgr.market.applyPreset' }));
  expect((within(editor).getByLabelText('sandboxMgr.market.description') as HTMLTextAreaElement).value).toContain(
    '用户级通用工具沙箱'
  );
  fireEvent.click(within(editor).getByRole('button', { name: 'save-spec' }));
  await waitFor(() =>
    expect(mockDispatch.mock.calls.some(([action]) => action.type === 'sandboxMgr/saveServiceSpec')).toBe(true)
  );
  const saved = mockDispatch.mock.calls.find(([action]) => action.type === 'sandboxMgr/saveServiceSpec')[0].payload;
  expect(saved.serviceType).toBe('private-existing-profile-type');
  expect(saved.ownerScope).toBe('USER');
  const config = JSON.parse(saved.specJson);
  expect(config.image).toBe('keep-tools-image');
  expect(config.startup).toEqual({ entrypoint: ['keep-entrypoint', 'tools'] });
  expect(config.env).toEqual({ PRIVATE_TOKEN: 'keep-fixture' });
  expect(config.runtimeOptions.toolSandbox.purpose).toBe('general');
  expect(config.runtimeOptions.toolSandbox.coverImage).toBe('/tool-sandbox/covers/general.svg');
  expect(config.runtimeOptions.lifecycle.autoStart).toBe('false');
  expect(mockDispatch.mock.calls.some(([action]) => action.type === 'sandboxMgr/saveServiceProfile')).toBe(false);
});
