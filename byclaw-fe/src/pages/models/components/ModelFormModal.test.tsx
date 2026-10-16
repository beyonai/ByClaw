import { act, render } from '@testing-library/react';
import ModelFormModal from './ModelFormModal';
import { getMyModels, getPublicModels } from '../service';

const mockGetSourceSystemList = jest.fn();
const mockGetDcSystemConfigListByStandType = jest.fn();
let mockSharedModelFormProps: any;

jest.mock('@umijs/max', () => ({
  getLocale: () => 'zh-CN',
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

jest.mock('@/pages/manager/utils/auth', () => ({
  getSessionKey: () => 'session-1',
  getssoToken: () => 'sso-token',
  getToken: () => 'token-1',
  ssotokenKey: 'SSO-TOKEN',
  tokenKey: 'Beyond-Token',
}));

jest.mock('@/pages/manager/utils/signature', () => ({
  generateSignature: () => ({ 'x-signature': 'signed' }),
}));

jest.mock('@/pages/manager/service/OrgMgr', () => ({
  getSourceSystemList: (...args: any[]) => mockGetSourceSystemList(...args),
}));

jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfigListByStandType: (...args: any[]) => mockGetDcSystemConfigListByStandType(...args),
}));

jest.mock('@/pages/manager/pages/ModelMgr/components/SharedModelFormModal', () => (props: any) => {
  mockSharedModelFormProps = props;
  return <div data-testid="shared-model-form" />;
});

jest.mock('../service', () => ({
  getMyModelDetail: jest.fn(),
  upsertMyModel: jest.fn(),
  getMyModels: jest.fn(),
  getPublicModels: jest.fn(),
}));

const renderForm = (type: 'add' | 'edit' = 'add') => {
  render(<ModelFormModal open type={type} onCancel={jest.fn()} onSaved={jest.fn()} />);
  return mockSharedModelFormProps;
};

describe('models/components/ModelFormModal', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSharedModelFormProps = undefined;
  });

  it('does not copy personal or public model records into official templates', () => {
    const row = { id: 7, modelCode: 'model2', modelType: 'LLM', apiEndpoint: 'https://example.test/v1' };
    (getMyModels as jest.Mock).mockResolvedValue({ code: 0, data: { rows: [row], total: 1 } });
    (getPublicModels as jest.Mock).mockResolvedValue({ code: 0, data: { rows: [row], total: 1 } });
    expect(renderForm()).not.toHaveProperty('loadConfiguredPresets');
    expect(getMyModels).not.toHaveBeenCalled();
    expect(getPublicModels).not.toHaveBeenCalled();
  });

  it('uses the personal JSON image endpoint and returns the upstream image response', async () => {
    const data = { data: [{ url: 'https://example.test/image.jpeg' }] };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data }) });
    const signal = new AbortController().signal;
    const onDelta = jest.fn();
    const props = renderForm();
    await expect(
      props.runDebugRequest({ modelId: 42, modelType: 'IMAGE_GENERATION', input: '{}', signal, onDelta })
    ).resolves.toEqual({ output: JSON.stringify(data, null, 2) });
    expect(global.fetch).toHaveBeenCalledWith('/byaiService/personal/model/debugImageGeneration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '42', input: '{}' }),
      signal,
    });
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('keeps the existing LLM stream endpoint and delta behavior', async () => {
    const chunk = new TextEncoder().encode('data:{"choices":[{"delta":{"content":"ok"}}]}\n\ndata:[DONE]\n\n');
    const read = jest.fn().mockResolvedValueOnce({ done: false, value: chunk }).mockResolvedValueOnce({ done: true });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/event-stream' },
      body: { getReader: () => ({ read }) },
    });
    const props = renderForm();
    const onDelta = jest.fn();
    await expect(props.runDebugRequest({ modelId: 42, modelType: 'LLM', input: '{}', onDelta })).resolves.toEqual({
      output: 'ok',
    });
    expect(global.fetch).toHaveBeenCalledWith('/byaiService/personal/model/debug', expect.any(Object));
    expect(onDelta).toHaveBeenCalledWith('ok');
  });

  it('reports image API failures rather than treating HTTP 200 as success', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 40001, msg: 'invalid model' }) });
    await expect(
      renderForm().runDebugRequest({ modelId: 42, modelType: 'IMAGE_GENERATION', input: '{}' })
    ).rejects.toThrow('invalid model');
  });

  it.each(['add', 'edit'] as const)('loads ability and system tag options for the %s form', async (type) => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({
      data: [{ paramName: '对话模型', paramValue: '3' }],
    });
    mockGetSourceSystemList.mockResolvedValue({
      data: [{ systemName: 'ByClaw', systemCode: 'BY_CLAW' }],
    });

    renderForm(type);

    expect(mockSharedModelFormProps.showTags).toBe(true);

    let abilities: any[] = [];
    let systems: any[] = [];
    await act(async () => {
      abilities = await mockSharedModelFormProps.loadAbilityOptions();
      systems = await mockSharedModelFormProps.loadSystemOptions();
    });

    expect(mockGetDcSystemConfigListByStandType).toHaveBeenCalledWith({ standType: 'MODEL_TAGS' });
    expect(abilities).toEqual([{ label: '对话模型', value: '3' }]);
    expect(mockGetSourceSystemList).toHaveBeenCalledWith({ types: ['DIG_EMPLOYEE'] });
    expect(systems).toEqual([{ label: 'ByClaw', value: 'BY_CLAW' }]);
  });

  it.each(['add', 'edit'] as const)('enables dictionary loading for %s forms', async (type) => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({
      data: [{ paramName: '图片理解', paramValue: '3' }],
    });
    const props = renderForm(type);

    // 共享弹窗仅在 showTags 和加载回调同时存在时发起请求。
    expect(props.showTags).toBe(true);
    await expect(props.loadAbilityOptions()).resolves.toEqual([{ label: '图片理解', value: '3' }]);
    expect(mockGetDcSystemConfigListByStandType).toHaveBeenCalledWith({ standType: 'MODEL_TAGS' });
  });

  it('supports legacy dictionary fields and skips empty codes', async () => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({
      data: [
        { standDisplayValue: ' 推理 ', standCode: 4 },
        { param_name: ' 语音 ', param_value: ' 6 ' },
        { paramValue: '5' },
        { paramName: '无效选项', paramValue: ' ' },
      ],
    });
    await expect(renderForm().loadAbilityOptions()).resolves.toEqual([
      { label: '推理', value: '4' },
      { label: '语音', value: '6' },
      { label: '5', value: '5' },
    ]);
  });

  it.each([undefined, null, {}, []])('handles missing or empty dictionary data: %p', async (data) => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({ data });
    await expect(renderForm().loadAbilityOptions()).resolves.toEqual([]);
  });

  it('propagates request failures to the shared form error handler', async () => {
    mockGetDcSystemConfigListByStandType.mockRejectedValue(new Error('dictionary unavailable'));
    await expect(renderForm().loadAbilityOptions()).rejects.toThrow('dictionary unavailable');
  });
});
