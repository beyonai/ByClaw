import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider, Form, message } from 'antd';
import type { FormInstance } from 'antd';
import ModelFormFields from '../ModelFormFields';
import SharedModelFormModal from '../SharedModelFormModal';

const mockIntl = { locale: 'zh-CN', formatMessage: ({ id }: { id: string }) => id };
jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl }));
jest.mock('@/pages/manager/service/System', () => ({
  getByParamGroupCode: jest.fn().mockResolvedValue({ data: { byaiSystemConfigLists: [] } }),
}));
jest.mock('../useModelTypeOptions', () => () => [
  { label: 'Image', value: 'IMAGE_GENERATION' },
  { label: 'LLM', value: 'LLM' },
]);
jest.mock('../ModelDebugPanel', () => () => <div />);
jest.mock('../ModelFormSection', () => ({ title, children }: any) => <section aria-label={title}>{children}</section>);

const savedDetail = {
  id: '42',
  displayName: 'Existing model',
  modelCode: 'custom-model',
  apiEndpoint: 'https://proxy.example/custom',
  apiToken: 'test-token-not-a-secret',
};

async function renderEdit(fields: Record<string, any>) {
  const saveModelRequest = jest.fn().mockResolvedValue({ data: { id: '42' } });
  await act(async () => {
    render(
      <ConfigProvider virtual={false} theme={{ token: { motion: false } }}>
        <SharedModelFormModal
          open
          type="edit"
          data={{ id: '42' }}
          onCancel={jest.fn()}
          onSaved={jest.fn()}
          loadDetail={jest.fn().mockResolvedValue({ ...savedDetail, ...fields })}
          saveModelRequest={saveModelRequest}
          runDebugRequest={jest.fn()}
          statusOptions={[{ label: 'Enabled', value: 'ENABLED' }]}
        />
      </ConfigProvider>
    );
  });
  await waitFor(() => expect(screen.getByLabelText('modelMgr.modal.displayName')).toHaveValue(savedDetail.displayName));
  return saveModelRequest;
}

async function saveEdit(saveModelRequest: jest.Mock) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
  });
  await waitFor(() => expect(saveModelRequest).toHaveBeenCalledTimes(1));
  return saveModelRequest.mock.calls[0][0];
}

describe('optional model provider compatibility', () => {
  afterEach(() => message.destroy());

  it('requires a provider only for image protocols that cannot identify one', async () => {
    let form: FormInstance;
    const TestForm = () => {
      [form] = Form.useForm();
      return (
        <ConfigProvider virtual={false} theme={{ token: { motion: false } }}>
          <ModelFormFields
            form={form}
            modalTitle="model"
            systemOptions={[]}
            abilityOptions={[]}
            modelTypeOptions={[]}
            statusOptions={[]}
            tokenVisible={false}
            setTokenVisible={jest.fn()}
            isSectionOpen={() => true}
            toggleSection={jest.fn()}
            onValuesChange={jest.fn()}
          />
        </ConfigProvider>
      );
    };
    await act(async () => {
      render(<TestForm />);
    });
    for (const modelType of ['LLM', 'EMBEDDING', 'RERANK', 'IMAGE_GENERATION']) {
      await act(async () => {
        form!.setFieldsValue({ modelType, modelProtocol: 'VOLCENGINE_IMAGE', providerName: undefined });
      });
      await act(async () => {
        await expect(form!.validateFields(['providerName'])).resolves.toEqual({ providerName: undefined });
      });
    }
    await act(async () => form!.setFieldsValue({ modelProtocol: 'Qwen' }));
    await act(async () => {
      await expect(form!.validateFields(['providerName'])).rejects.toMatchObject({
        errorFields: [
          expect.objectContaining({ name: ['providerName'], errors: ['modelMgr.modal.imageProviderRequired'] }),
        ],
      });
    });
    await act(async () => form!.setFieldsValue({ providerName: 'QWEN' }));
    await act(async () => {
      await expect(form!.validateFields(['providerName'])).resolves.toEqual({ providerName: 'QWEN' });
    });
  });

  it.each([
    ['LLM', 'OpenAI', undefined, undefined],
    ['LLM', 'Anthropic', 'custom-provider', 'custom-provider'],
    ['IMAGE_GENERATION', 'VOLCENGINE_IMAGE', undefined, 'VOLCENGINE'],
    ['IMAGE_GENERATION', 'MINIMAX_IMAGE', undefined, 'MINIMAX'],
    ['IMAGE_GENERATION', 'VOLCENGINE_IMAGE', 'DOUBAO', 'DOUBAO'],
    ['IMAGE_GENERATION', 'Qwen', 'QWEN', 'QWEN'],
  ])('preserves %s / %s when editing provider %s', async (modelType, modelProtocol, providerName, expectedProvider) => {
    const save = await renderEdit({ modelType, modelProtocol, providerName });
    const payload = await saveEdit(save);
    expect(payload.providerName).toBe(expectedProvider);
    expect(payload).toMatchObject({
      modelType,
      modelProtocol,
      modelCode: savedDetail.modelCode,
      apiEndpoint: savedDetail.apiEndpoint,
    });
  });

  it.each([
    ['LLM', 'OpenAI', 'OpenAI', undefined],
    ['IMAGE_GENERATION', 'VOLCENGINE_IMAGE', 'VOLCENGINE', 'VOLCENGINE'],
  ])(
    'clears or infers the provider without resetting %s connection fields',
    async (modelType, modelProtocol, providerName, expectedProvider) => {
      const save = await renderEdit({ modelType, modelProtocol, providerName });
      const clear = screen
        .getByLabelText('modelMgr.modal.provider')
        .closest('.ant-select')!
        .querySelector('.ant-select-clear');
      expect(clear).not.toBeNull();
      await act(async () => {
        fireEvent.mouseDown(clear!);
      });
      const payload = await saveEdit(save);
      expect(payload.providerName).toBe(expectedProvider);
      expect(payload).toMatchObject({
        modelProtocol,
        modelCode: savedDetail.modelCode,
        apiEndpoint: savedDetail.apiEndpoint,
      });
    }
  );

  it('does not overwrite an explicit provider or connection fields when changing the image protocol', async () => {
    const save = await renderEdit({
      modelType: 'IMAGE_GENERATION',
      modelProtocol: 'MINIMAX_IMAGE',
      providerName: 'MINIMAX',
    });
    await act(async () => {
      fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.modelProtocol'));
    });
    const option = await screen.findByText('Volcengine Ark');
    await act(async () => {
      fireEvent.click(option);
    });
    const payload = await saveEdit(save);
    expect(payload).toMatchObject({
      providerName: 'MINIMAX',
      modelProtocol: 'VOLCENGINE_IMAGE',
      modelCode: savedDetail.modelCode,
      apiEndpoint: savedDetail.apiEndpoint,
    });
  });

  it('fills an empty provider when a known image protocol is selected without changing custom connection fields', async () => {
    const save = await renderEdit({ modelType: 'IMAGE_GENERATION', modelProtocol: 'Qwen', providerName: undefined });
    await act(async () => {
      fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.modelProtocol'));
    });
    const option = await screen.findByText('Volcengine Ark');
    await act(async () => {
      fireEvent.click(option);
    });
    const payload = await saveEdit(save);
    expect(payload).toMatchObject({
      providerName: 'VOLCENGINE',
      modelProtocol: 'VOLCENGINE_IMAGE',
      modelCode: savedDetail.modelCode,
      apiEndpoint: savedDetail.apiEndpoint,
    });
  });
});
