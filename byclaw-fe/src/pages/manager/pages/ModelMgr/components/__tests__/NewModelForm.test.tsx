import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  return {
    ...actual,
    // 保留真实弹层和表单，取消弹层首次打开时的动画准备帧，避免断言命中隐藏节点。
    Modal: (props: import('antd').ModalProps) => <actual.Modal {...props} transitionName="" maskTransitionName="" />,
  };
});
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

// 精确文本定位后校验原生按钮，避免对整个复杂表单反复计算可访问名称。
function getButton(name: string): HTMLButtonElement {
  const button = screen.getByText(name).closest('button');
  if (!button) throw new Error(`Button not found: ${name}`);
  expect(button).toBeVisible();
  return button;
}

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
    statusOptions: [
      { label: 'Enabled', value: 'ENABLED' },
      { label: 'Disabled', value: 'DISABLED' },
    ],
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
  await waitFor(() => expect(screen.getByLabelText('modelMgr.modal.apiToken')).toBeVisible());
  return saveModelRequest;
}

async function change(label: string, value: string) {
  await act(async () => {
    // 接入地址已移入更多配置，手动填写时先模拟用户展开所在分组。
    if (label === 'apiEndpoint') {
      const more = getButton('modelMgr.modal.moreConfig');
      if (more.getAttribute('aria-expanded') === 'false') fireEvent.click(more);
    }
    const input =
      label === 'quickPreset'
        ? screen.getByLabelText('modelMgr.modal.quickPreset', { selector: 'input' })
        : screen.getByLabelText(`modelMgr.modal.${label}`);
    fireEvent.change(input, { target: { value } });
  });
}

async function clickSave(name = 'modelMgr.modal.saveAndClose') {
  await act(async () => {
    fireEvent.click(getButton(name));
  });
}

async function selectOption(label: string) {
  // 先等待选项提交到 DOM，再进入点击的 act；不要在未结束的 act 中等待它自己的渲染结果。
  const option = await screen.findByText(label);
  await act(async () => {
    fireEvent.click(option);
  });
}

describe('new model quick setup', () => {
  // 用例覆盖真实表单、多次预设切换和保存；仅为本套件预留 CI 并发下的完整交互时间。
  jest.setTimeout(15000);
  afterEach(async () => {
    await act(async () => {
      cleanup();
      message.destroy();
    });
    mockIntl.locale = 'zh-CN';
  });

  it('preselects the chat application scope and submits it when creating a model', async () => {
    const save = await renderForm();
    expect(screen.getByLabelText('modelMgr.modal.apiToken')).toBeVisible();
    ['ability', 'status'].forEach((field) => {
      expect(screen.getByLabelText(`modelMgr.modal.${field}`).closest('.ant-form-item')).not.toBeVisible();
    });
    const abilitySelect = screen.getByLabelText('modelMgr.modal.ability').closest('.ant-select')! as HTMLElement;
    expect(within(abilitySelect).getByTitle('Chat model')).toBeInTheDocument();
    await change('modelCode', 'MiniMax-M3');
    await change('apiToken', 'test-token');
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ abilities: ['3'], status: 'ENABLED' });
  });

  it('reopens basic configuration when the required API Token is missing', async () => {
    const save = await renderForm();
    await change('modelCode', 'MiniMax-M3');
    await act(async () => {
      fireEvent.click(getButton('modelMgr.modal.basicConfig'));
    });
    expect(screen.getByLabelText('modelMgr.modal.apiToken')).not.toBeVisible();
    await clickSave();
    expect(await screen.findByText('modelMgr.modal.apiTokenRequired')).toBeVisible();
    expect(getButton('modelMgr.modal.basicConfig')).toHaveAttribute('aria-expanded', 'true');
    expect(save).not.toHaveBeenCalled();
    await change('apiToken', 'test-token');
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].apiToken).toBe('test-token');
  });

  it('omits redundant template copy and its empty hint area while keeping autofill', async () => {
    await renderForm();
    expect(screen.queryByText('modelMgr.modal.identityGroup')).not.toBeInTheDocument();
    expect(screen.queryByText('modelMgr.modal.quickPresetHint')).not.toBeInTheDocument();
    expect(screen.getByLabelText('modelMgr.modal.quickPreset', { selector: 'input' })).toBeInTheDocument();

    await change('modelCode', 'text-embedding-v4');
    expect(screen.getByLabelText('modelMgr.modal.displayName')).toHaveValue('text-embedding-v4');
    expect(screen.getByLabelText('modelMgr.modal.contextTokens')).toHaveValue('8192');
    expect(screen.queryByText('modelMgr.modal.presetAppliedHint')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'modelMgr.modal.presetSource' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('rebuilds debug paths when autofill switches between embeddings and Responses on the same endpoint', async () => {
    const save = await renderForm();
    await change('apiToken', 'test-token');
    await change('modelCode', 'text-embedding-3-small');
    expect(JSON.parse(screen.getByTestId('debug-input').textContent!)).toMatchObject({
      url: 'https://api.openai.com/v1/embeddings',
      model: 'text-embedding-3-small',
      input: expect.any(String),
    });
    await change('modelCode', 'gpt-6.1-sol');
    const responses = JSON.parse(screen.getByTestId('debug-input').textContent!);
    expect(responses).toMatchObject({
      url: 'https://api.openai.com/v1/responses',
      model: 'gpt-6.1-sol',
      max_output_tokens: 128000,
      input: [{ role: 'user', content: expect.any(String) }],
      reasoning: { effort: 'medium' },
    });
    expect(responses).not.toHaveProperty('messages');
    await change('modelCode', 'text-embedding-3-large');
    const embedding = JSON.parse(screen.getByTestId('debug-input').textContent!);
    expect(embedding.url).toBe('https://api.openai.com/v1/embeddings');
    expect(embedding).not.toHaveProperty('max_output_tokens');
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      modelType: 'EMBEDDING',
      modelProtocol: 'OpenAI',
      modelCode: 'text-embedding-3-large',
      apiToken: 'test-token',
    });
  });

  it('preserves a cleared application scope across model changes and save-and-continue', async () => {
    const save = await renderForm();
    await act(async () => {
      fireEvent.click(getButton('modelMgr.modal.moreBasicSettings'));
    });
    const abilitySelect = screen.getByLabelText('modelMgr.modal.ability').closest('.ant-select')! as HTMLElement;
    expect(abilitySelect).toBeVisible();
    await act(async () => {
      fireEvent.mouseDown(abilitySelect.querySelector('.ant-select-clear')!);
    });
    expect(within(abilitySelect).queryByTitle('Chat model')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(getButton('modelMgr.modal.moreBasicSettings'));
    });
    expect(abilitySelect).not.toBeVisible();
    await change('modelCode', 'MiniMax-M3');
    await change('modelCode', 'deepseek-flash');
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
    ['zh-CN', 'qwen3.6-plus · 阿里云（阿里云百炼接入）'],
    ['en-US', 'qwen3.6-plus · Alibaba Cloud (via Alibaba Cloud Model Studio)'],
  ])('offers localized official templates without arbitrary saved names: %s', async (locale, expectedLabel) => {
    mockIntl.locale = locale;
    await renderForm('add', { displayName: 'Example test model', modelCode: 'model2' });
    fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.quickPreset', { selector: 'input' }));
    await change('quickPreset', 'model2');
    expect(screen.queryByText('Example test model')).not.toBeInTheDocument();
    expect(screen.queryByText('model2')).not.toBeInTheDocument();
    await change('quickPreset', 'qwen3.6-plus');
    expect(await screen.findByText(expectedLabel)).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('modelMgr.modal.quickPreset', { selector: 'input' }), {
        key: 'Escape',
        keyCode: 27,
      });
    });
    await change('modelCode', 'model2');
    expect(screen.getByLabelText('modelMgr.modal.modelCode')).toHaveValue('model2');
    expect(screen.getByLabelText('modelMgr.modal.contextTokens')).toHaveValue('202752');
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
      65536,
      true,
    ],
  ])(
    'saves %s from its public template with only a user-supplied key',
    async (search, label, modelCode, contextTokens, maxTokens, enabled) => {
      const save = await renderForm();
      fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.quickPreset', { selector: 'input' }));
      await change('quickPreset', search);
      await selectOption(label);
      await change('apiToken', 'test-token');
      const expectedHints = [
        ...(modelCode === 'kimi-for-coding' ? ['modelMgr.modal.kimiCodePresetHint'] : []),
        ...(['glm-5.3', 'ZHIPU/GLM-5.3-Flash', 'kimi-k2.7-code'].includes(modelCode)
          ? ['modelMgr.modal.presetThinkingRequiredHint']
          : []),
      ];
      for (const hint of expectedHints) {
        expect(screen.getByText(hint)).toBeVisible();
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
    expect(getButton('modelMgr.modal.moreConfig')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('modelMgr.modal.connectTimeoutSec')).not.toBeVisible();
    expect(screen.getByLabelText('modelMgr.modal.apiEndpoint')).not.toBeVisible();
    expect(screen.getByLabelText('modelMgr.modal.systemTags')).not.toBeVisible();
    fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.quickPreset', { selector: 'input' }));
    await change('quickPreset', 'doubao-seedream-4-0-250828');
    await selectOption('doubao-seedream-4-0-250828 · 字节跳动（火山方舟接入）');
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
    await change('modelCode', 'deepseek-flash');
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      displayName: 'Private gateway',
      apiEndpoint: 'https://proxy.example/v1',
      apiToken: 'test-token',
      modelCode: 'deepseek-flash',
      contextTokens: 1048576,
      maxTokens: 393216,
    });
  });

  it('keeps the image type shortcut usable without clearing a manually entered token or endpoint', async () => {
    const save = await renderForm();
    await change('apiToken', 'test-token');
    await change('apiEndpoint', 'https://proxy.example/images');
    fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.modelType'));
    await selectOption('Image');
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
    await change('modelCode', 'deepseek-flash');
    await change('apiToken', 'test-token');
    await act(async () => {
      fireEvent.click(getButton('modelMgr.modal.moreConfig'));
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
      fireEvent.click(getButton('modelMgr.modal.moreConfig'));
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

  it.each(['private-alias', 'sensenova-6.8-flash-lite'])(
    'fills and saves both defaults when official capacities are missing: %s',
    async (modelCode) => {
      const save = await renderForm();
      await change('modelCode', modelCode);
      if (modelCode === 'private-alias') await change('apiEndpoint', 'https://proxy.example/v1');
      await change('apiToken', 'test-token');
      expect(screen.getByLabelText('modelMgr.modal.contextTokens')).toHaveValue('202752');
      expect(screen.getByLabelText('modelMgr.modal.maxTokens')).toHaveValue('65536');
      await clickSave();
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(save.mock.calls[0][0]).toMatchObject({ modelCode, contextTokens: 202752, maxTokens: 65536 });
    }
  );

  it('validates a manually cleared context and accepts smaller valid limits', async () => {
    const save = await renderForm();
    await change('modelCode', 'private-alias');
    await change('apiEndpoint', 'https://proxy.example/v1');
    await change('apiToken', 'test-token');
    expect(screen.getByLabelText('modelMgr.modal.maxTokens')).toHaveValue('65536');
    expect(screen.getByLabelText('modelMgr.modal.contextTokens')).toHaveValue('202752');
    expect(screen.getByText('modelMgr.modal.unknownModelHint')).toBeInTheDocument();
    await change('contextTokens', '');
    await act(async () => {
      fireEvent.click(getButton('modelMgr.modal.moreConfig'));
    });
    expect(screen.getByLabelText('modelMgr.modal.contextTokens')).not.toBeVisible();
    await clickSave();
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(getButton('modelMgr.modal.moreConfig')).toHaveAttribute('aria-expanded', 'true'));
    await change('contextTokens', '8192');
    expect(screen.getByLabelText('modelMgr.modal.maxTokens')).toHaveValue('8192');
    await change('maxTokens', '1024');
    await change('temperature', '0.7');
    await change('connectTimeoutSec', '45');
    await act(async () => {
      fireEvent.click(getButton('modelMgr.modal.moreConfig'));
    });
    // 合并后的连接和参数字段收起后仍注册在表单中，保存不能丢失手动填写的值。
    expect(screen.getByLabelText('modelMgr.modal.connectTimeoutSec')).not.toBeVisible();
    expect(screen.getByLabelText('modelMgr.modal.contextTokens')).not.toBeVisible();
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      apiEndpoint: 'https://proxy.example/v1',
      contextTokens: 8192,
      maxTokens: 1024,
      temperature: 0.7,
      connectTimeoutSec: 45,
    });
    expect(JSON.parse(screen.getByTestId('debug-input').textContent!)).toMatchObject({
      max_tokens: 1024,
      temperature: 0.7,
    });
  });

  it.each([
    [undefined, undefined, 65536],
    [128000, undefined, 65536],
    [32768, undefined, 32768],
    [128000, 8192, 8192],
  ])(
    'uses the same edit fallback without replacing saved output budgets: %s / %s',
    async (contextTokens, maxTokens, expected) => {
      const save = await renderForm('edit', {
        displayName: 'Existing model',
        modelType: 'LLM',
        modelCode: 'custom-model',
        modelProtocol: 'OpenAI',
        apiEndpoint: 'https://proxy.example/v1',
        apiToken: 'test-token',
        contextTokens,
        maxTokens,
      });
      expect(screen.getByLabelText('modelMgr.modal.maxTokens')).toHaveValue(String(expected));
      expect(screen.getByLabelText('modelMgr.modal.contextTokens')).toHaveValue(String(contextTokens ?? 202752));
      await clickSave('common.confirm');
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(save.mock.calls[0][0]).toMatchObject({ contextTokens: contextTokens ?? 202752, maxTokens: expected });
    }
  );

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
      status: 'DISABLED',
    };
    const save = await renderForm('edit', detail);
    await waitFor(() => expect(screen.getByLabelText('modelMgr.modal.displayName')).toHaveValue('Existing'));
    expect(getButton('modelMgr.modal.basicConfig')).toHaveAttribute('aria-expanded', 'true');
    expect(getButton('modelMgr.modal.moreConfig')).toHaveAttribute('aria-expanded', 'true');
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
    fireEvent.click(getButton('modelMgr.modal.moreConfig'));
    await change('temperature', '0.4');
    await clickSave();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toMatchObject({ id: '42', contextTokens: 1000000, temperature: 0.4 });
    expect(JSON.parse(screen.getByTestId('debug-input').textContent!).temperature).toBe(0.4);
  });
});
