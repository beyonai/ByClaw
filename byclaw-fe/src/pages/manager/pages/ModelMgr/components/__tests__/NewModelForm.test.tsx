import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider, message } from 'antd';
import SharedModelFormModal from '../SharedModelFormModal';

const mockIntl = {
  locale: 'zh-CN',
  formatMessage: ({ id }: { id: string }, values: Record<string, string> = {}): string => {
    // 标签采用真实翻译，其他字段仍返回 ID，保留原有表单定位方式。
    if (!/^modelMgr\.modal\.preset(LabelWith|Developer\.|Channel\.)/.test(id)) return id;
    const messages =
      mockIntl.locale === 'en-US'
        ? jest.requireActual('@/locales/en-US/manager').default
        : jest.requireActual('@/locales/zh-CN/manager').default;
    return messages[id].replace(/\{(\w+)\}/g, (_match: string, key: string) => values[key] ?? '');
  },
};
jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl }));
jest.mock('@/pages/manager/service/System', () => ({
  getByParamGroupCode: jest.fn().mockResolvedValue({ data: { byaiSystemConfigLists: [] } }),
}));
jest.mock('../useModelTypeOptions', () => () => [
  { label: 'Image', value: 'IMAGE_GENERATION' },
  { label: 'LLM', value: 'LLM' },
  { label: 'Embedding', value: 'EMBEDDING' },
  { label: 'TTS', value: 'TTS' },
]);
jest.mock('../ModelDebugPanel', () => ({ debugInput }: any) => <pre data-testid="debug-input">{debugInput}</pre>);

async function renderForm(type: 'add' | 'edit' = 'add', detail: Record<string, any> = {}) {
  const saveModelRequest = jest.fn().mockResolvedValue({ data: { id: '42' } });
  const props = {
    open: true,
    type,
    data: type === 'edit' ? { id: '42' } : undefined,
    onCancel: jest.fn(),
    onSaved: jest.fn(),
    loadDetail: jest.fn().mockResolvedValue(detail),
    saveModelRequest,
    runDebugRequest: jest.fn(),
    extractModelIdFromSave: (res: any) => res.data.id,
    statusOptions: [{ label: 'Enabled', value: 'ENABLED' }],
    showTags: true,
    loadAbilityOptions: jest.fn().mockResolvedValue([
      { label: 'Chat model', value: '3' },
      { label: 'QA', value: '6' },
    ]),
  };
  await act(async () => {
    render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <SharedModelFormModal {...props} />
      </ConfigProvider>
    );
  });
  return saveModelRequest;
}

async function change(label: string, value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(`modelMgr.modal.${label}`), { target: { value } });
  });
}

async function clickSave(name = 'modelMgr.modal.saveAndClose') {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

describe('new model quick setup', () => {
  afterEach(async () => {
    await act(async () => message.destroy());
    mockIntl.locale = 'zh-CN';
  });

  it('preselects the chat application scope and submits it when creating a model', async () => {
    const save = await renderForm();
    const abilitySelect = screen.getByLabelText('modelMgr.modal.ability').closest('.ant-select')! as HTMLElement;
    expect(within(abilitySelect).getByTitle('Chat model')).toBeInTheDocument();
    await change('modelCode', 'MiniMax-M3');
    await change('apiToken', 'test-token');
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].abilities).toEqual(['3']);
  });

  it('preserves a cleared application scope across model changes and save-and-continue', async () => {
    const save = await renderForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'modelMgr.modal.tagConfig' }));
    });
    const abilitySelect = screen.getByLabelText('modelMgr.modal.ability').closest('.ant-select')! as HTMLElement;
    await act(async () => {
      fireEvent.mouseDown(abilitySelect.querySelector('.ant-select-clear')!);
    });
    expect(within(abilitySelect).queryByTitle('Chat model')).not.toBeInTheDocument();
    await change('modelCode', 'MiniMax-M3');
    await change('modelCode', 'deepseek-v4-pro');
    await change('apiToken', 'test-token');
    await clickSave('modelMgr.modal.saveAndContinue');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].abilities).toEqual([]);
    await change('displayName', 'Renamed model');
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toMatchObject({ id: '42', abilities: [] });
  });

  it.each([
    ['zh-CN', 'Qwen3.6-Plus · 阿里云（阿里云百炼接入）'],
    ['en-US', 'Qwen3.6-Plus · Alibaba Cloud (via Alibaba Cloud Model Studio)'],
  ])('offers localized official templates without arbitrary saved names: %s', async (locale, expectedLabel) => {
    mockIntl.locale = locale;
    await renderForm('add', { displayName: 'Example test model', modelCode: 'model2' });
    fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.quickPreset'));
    await change('quickPreset', 'model2');
    expect(screen.queryByText('Example test model')).not.toBeInTheDocument();
    expect(screen.queryByText('model2')).not.toBeInTheDocument();
    await change('quickPreset', 'qwen3.6-plus');
    expect(await screen.findByText(expectedLabel)).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('modelMgr.modal.quickPreset'), { key: 'Escape', keyCode: 27 });
    });
    await change('modelCode', 'model2');
    expect(screen.getByLabelText('modelMgr.modal.modelCode')).toHaveValue('model2');
    expect(screen.getByLabelText('modelMgr.modal.contextTokens')).toHaveValue('');
  });

  it('preserves a custom saved model when editing, even when it is not an official template', async () => {
    const save = await renderForm('edit', {
      displayName: 'Example test model',
      modelCode: 'model2',
      modelType: 'LLM',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://custom.example/v1',
      apiToken: 'test-token',
      contextTokens: 300000,
      maxTokens: 16384,
    });
    expect(screen.queryByLabelText('modelMgr.modal.quickPreset')).not.toBeInTheDocument();
    await clickSave('common.confirm');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      id: '42',
      displayName: 'Example test model',
      modelCode: 'model2',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://custom.example/v1',
      contextTokens: 300000,
      maxTokens: 16384,
    });
  });

  it.each<[string, string, string, number, number | undefined, boolean]>([
    ['GLM-5.3', 'GLM-5.3 · 智谱（阿里云百炼接入）', 'glm-5.3', 1048576, 131072, true],
    ['ZHIPU/GLM-5.3-Flash', 'GLM-5.3-Flash · 智谱（阿里云百炼接入）', 'ZHIPU/GLM-5.3-Flash', 1048576, 131072, true],
    ['GLM-5.1', 'GLM-5.1 · 智谱（阿里云百炼接入）', 'glm-5.1', 202745, 131072, false],
    ['Kimi-K3', 'Kimi-K3 · 月之暗面（阿里云百炼接入）', 'kimi-k3', 1048576, 1048576, true],
    ['Kimi-K2.7-Code', 'Kimi-K2.7-Code · 月之暗面（阿里云百炼接入）', 'kimi-k2.7-code', 262144, 16384, true],
    [
      'Kimi-K2.8-Preview',
      'Kimi-K2.8-Preview (kimi-for-coding) · 月之暗面（Kimi Code接入）',
      'kimi-for-coding',
      1048576,
      undefined,
      true,
    ],
  ])(
    'saves %s from its public template with only a user-supplied key',
    async (search, label, modelCode, contextTokens, maxTokens, enabled) => {
      const save = await renderForm();
      fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.quickPreset'));
      await change('quickPreset', search);
      await act(async () => {
        fireEvent.click(await screen.findByText(label));
      });
      await change('apiToken', 'test-token');
      if (modelCode === 'kimi-for-coding') {
        expect(screen.getByText('modelMgr.modal.kimiCodePresetHint')).toBeVisible();
      }
      if (['glm-5.3', 'ZHIPU/GLM-5.3-Flash', 'kimi-k2.7-code'].includes(modelCode)) {
        expect(screen.getByText('modelMgr.modal.presetThinkingRequiredHint')).toBeVisible();
      }
      const debug = JSON.parse(screen.getByTestId('debug-input').textContent || '{}');
      expect(debug.model).toBe(modelCode);
      expect(debug.max_tokens).toBe(maxTokens);
      expect(screen.getByLabelText('modelMgr.modal.contextTokens')).toHaveValue(String(contextTokens));
      expect(screen.getByLabelText('modelMgr.modal.maxTokens')).toHaveValue(
        maxTokens === undefined ? '' : String(maxTokens)
      );
      expect(debug).not.toHaveProperty('temperature');
      await clickSave();
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(save.mock.calls[0][0]).toMatchObject({
        modelCode,
        modelType: 'LLM',
        modelProtocol: 'OpenAI',
        providerName: modelCode === 'kimi-for-coding' ? 'Moonshot' : 'Bailian',
        contextTokens,
        maxTokens,
        apiToken: 'test-token',
        apiEndpoint:
          modelCode === 'kimi-for-coding'
            ? 'https://api.kimi.com/coding/v1'
            : 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        reasoningConfig: { enabled },
      });
    }
  );

  it('does not apply a newly added official template over a saved deployment with the same model ID', async () => {
    const detail = {
      displayName: 'Existing GLM deployment',
      modelCode: 'glm-5.3',
      modelType: 'LLM',
      modelProtocol: 'Anthropic',
      providerName: 'custom-provider',
      apiEndpoint: 'https://existing.example/api',
      apiToken: 'test-token',
      contextTokens: 300000,
      maxTokens: 4096,
      reasoningConfig: { enabled: false, capability: 'binary', compatFormat: 'anthropic', defaultLevel: 'off' },
    };
    const save = await renderForm('edit', detail);
    expect(screen.queryByText('modelMgr.modal.presetThinkingRequiredHint')).not.toBeInTheDocument();
    await clickSave('common.confirm');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ id: '42', ...detail });
  });

  it('starts with advanced settings collapsed and saves a selected Seedream preset with only a key', async () => {
    const save = await renderForm();
    expect(screen.getByRole('button', { name: 'modelMgr.modal.paramConfig' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByLabelText('modelMgr.modal.connectTimeoutSec')).not.toBeVisible();
    expect(screen.getByLabelText('modelMgr.modal.systemTags')).not.toBeVisible();
    fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.quickPreset'));
    await change('quickPreset', 'doubao-seedream-4-0-250828');
    await act(async () => {
      fireEvent.click(await screen.findByText('doubao-seedream-4-0-250828 · 字节跳动（火山方舟接入）'));
    });
    await change('apiToken', 'test-token');
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      displayName: 'doubao-seedream-4-0-250828',
      modelCode: 'doubao-seedream-4-0-250828',
      modelType: 'IMAGE_GENERATION',
      providerName: 'VOLCENGINE',
      modelProtocol: 'VOLCENGINE_IMAGE',
      imageGenerationConfig: { size: '2K', responseFormat: 'url', watermark: true },
      apiToken: 'test-token',
      connectTimeoutSec: 32,
      readTimeoutSec: 60,
      maxRetries: 3,
      retryIntervalSec: 1,
    });
    expect(save.mock.calls[0][0]).not.toHaveProperty('presetId');
  });

  it('fills a recognized typed model but preserves manual name and proxy across switches', async () => {
    const save = await renderForm();
    await change('displayName', 'Private gateway');
    await change('apiEndpoint', 'https://proxy.example/v1');
    await change('apiToken', 'test-token');
    await change('modelCode', 'MiniMax-M3');
    await change('modelCode', 'deepseek-v4-pro');
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      displayName: 'Private gateway',
      apiEndpoint: 'https://proxy.example/v1',
      apiToken: 'test-token',
      modelCode: 'deepseek-v4-pro',
      contextTokens: 1048576,
      maxTokens: 393216,
    });
  });

  it('keeps the image type shortcut usable without clearing a manually entered token or endpoint', async () => {
    const save = await renderForm();
    await change('apiToken', 'test-token');
    await change('apiEndpoint', 'https://proxy.example/images');
    fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.modelType'));
    await act(async () => {
      fireEvent.click(await screen.findByText('Image'));
    });
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      modelType: 'IMAGE_GENERATION',
      modelCode: 'image-01',
      displayName: 'image-01',
      modelProtocol: 'MINIMAX_IMAGE',
      apiEndpoint: 'https://proxy.example/images',
      apiToken: 'test-token',
    });
  });

  it('synchronizes thinking toggles and keeps a manual context slider value across model switches', async () => {
    const save = await renderForm();
    await change('modelCode', 'deepseek-v4-pro');
    await change('apiToken', 'test-token');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'modelMgr.modal.paramConfig' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'modelMgr.modal.reasoningEnabled' }));
    });
    expect(JSON.parse(screen.getByTestId('debug-input').textContent!)).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft', keyCode: 37 });
    });
    const context = screen.getByLabelText('modelMgr.modal.contextTokens') as HTMLInputElement;
    const manualContext = Number(context.value);
    expect(manualContext).not.toBe(1048576);
    await change('modelCode', 'private-alias');
    expect(context).toHaveValue(manualContext.toString());
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ contextTokens: manualContext, reasoningConfig: { enabled: true } });
  });

  it('rejects a known official capacity overflow but lets a custom proxy define its own capacity', async () => {
    const save = await renderForm();
    await change('modelCode', 'MiniMax-M3');
    await change('apiToken', 'test-token');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'modelMgr.modal.paramConfig' }));
    });
    await change('contextTokens', '2000000');
    await clickSave();
    expect(save).not.toHaveBeenCalled();
    await screen.findByText('modelMgr.modal.contextTokensMax');
    await change('apiEndpoint', 'https://proxy.example/v1');
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].contextTokens).toBe(2000000);
  });

  it('opens a hidden validation error for unknown models and accepts smaller valid limits', async () => {
    const save = await renderForm();
    await change('modelCode', 'private-alias');
    await change('apiEndpoint', 'https://proxy.example/v1');
    await change('apiToken', 'test-token');
    expect(screen.getByText('modelMgr.modal.unknownModelHint')).toBeInTheDocument();
    await clickSave();
    expect(save).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'modelMgr.modal.paramConfig' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    );
    await change('contextTokens', '8192');
    await change('maxTokens', '1024');
    await change('temperature', '0.7');
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ contextTokens: 8192, maxTokens: 1024, temperature: 0.7 });
    expect(JSON.parse(screen.getByTestId('debug-input').textContent!)).toMatchObject({
      max_tokens: 1024,
      temperature: 0.7,
    });
  });

  it.each([{ abilities: [] }, { abilities: ['6'] }])('preserves saved values: %j', async ({ abilities }) => {
    const detail = {
      displayName: 'Existing',
      modelType: 'LLM',
      modelCode: 'MiniMax-M3',
      providerName: 'custom-provider',
      modelProtocol: 'Anthropic',
      apiEndpoint: 'https://proxy.example',
      apiToken: 'test-token',
      contextTokens: 8192,
      maxTokens: 1024,
      temperature: 0.3,
      topP: 0.7,
      abilities,
    };
    const save = await renderForm('edit', detail);
    await waitFor(() => expect(screen.getByLabelText('modelMgr.modal.displayName')).toHaveValue('Existing'));
    expect(screen.queryByLabelText('modelMgr.modal.quickPreset')).not.toBeInTheDocument();
    await change('displayName', 'Renamed');
    await clickSave('common.confirm');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ ...detail, displayName: 'Renamed' });
  });

  it('stops automatic capability changes after save-and-continue and keeps debug sampling in sync', async () => {
    const save = await renderForm();
    await change('modelCode', 'MiniMax-M3');
    await change('apiToken', 'test-token');
    await clickSave('modelMgr.modal.saveAndContinue');
    await waitFor(() => expect(screen.queryByLabelText('modelMgr.modal.quickPreset')).not.toBeInTheDocument());
    await change('modelCode', 'private-alias');
    fireEvent.click(screen.getByRole('button', { name: 'modelMgr.modal.paramConfig' }));
    await change('temperature', '0.4');
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toMatchObject({ id: '42', contextTokens: 1000000, temperature: 0.4 });
    expect(JSON.parse(screen.getByTestId('debug-input').textContent!).temperature).toBe(0.4);
  });
});
