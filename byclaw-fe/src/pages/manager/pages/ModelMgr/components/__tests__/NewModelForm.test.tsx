import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider, message } from 'antd';
import SharedModelFormModal from '../SharedModelFormModal';

const mockIntl = { locale: 'zh-CN', formatMessage: ({ id }: { id: string }) => id };
jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl }));
jest.mock('@/pages/manager/service/System', () => ({
  getByParamGroupCode: jest.fn().mockResolvedValue({ data: { byaiSystemConfigLists: [] } }),
}));
jest.mock('../useModelTypeOptions', () => () => [
  { label: 'Image', value: 'IMAGE_GENERATION' },
  { label: 'LLM', value: 'LLM' },
  { label: 'Embedding', value: 'EMBEDDING' },
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
      fireEvent.click(await screen.findByText('Volcengine Ark · doubao-seedream-4-0-250828'));
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
      maxTokens: 8192,
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

  it('preserves saved values and omits the quick picker when editing an existing model', async () => {
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
