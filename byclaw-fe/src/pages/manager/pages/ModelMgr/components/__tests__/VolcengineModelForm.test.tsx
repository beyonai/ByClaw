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

describe('image provider form isolation', () => {
  afterEach(async () => {
    await act(async () => {
      message.destroy();
    });
  });

  it('shows Seedream fields only for its protocol and restores existing MiniMax fields', async () => {
    let form: FormInstance;
    const TestForm = () => {
      [form] = Form.useForm();
      return (
        <ConfigProvider theme={{ token: { motion: false } }}>
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
    await act(async () => {
      form!.setFieldsValue({
        modelType: 'IMAGE_GENERATION',
        modelProtocol: 'VOLCENGINE_IMAGE',
        modelCode: 'ep-custom',
      });
    });
    expect(screen.getByLabelText('modelMgr.modal.imageSize')).toBeInTheDocument();
    expect(screen.queryByLabelText('modelMgr.modal.aspectRatio')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('modelMgr.modal.imageCount')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('modelMgr.modal.imageSize'), { target: { value: '2048x2048' } });
    fireEvent.click(screen.getByRole('switch', { name: 'modelMgr.modal.imageWatermark' }));
    expect(form!.getFieldValue('imageGenerationConfig')).toMatchObject({ size: '2048x2048', watermark: false });
    await act(async () => form!.setFieldsValue({ modelProtocol: 'MINIMAX_IMAGE' }));
    expect(screen.getByLabelText('modelMgr.modal.aspectRatio')).toBeInTheDocument();
    expect(screen.getByLabelText('modelMgr.modal.imageCount')).toBeInTheDocument();
    expect(screen.queryByLabelText('modelMgr.modal.imageSize')).not.toBeInTheDocument();
  });

  // 同一弹窗连续回填并保存两条记录，保留完整串值校验，同时为 CI 并发执行预留时间。
  it('preserves saved image defaults, unknown keys and extension JSON when only the name is edited', async () => {
    const detail = {
      id: '42',
      displayName: 'Seedream',
      modelType: 'IMAGE_GENERATION',
      modelCode: 'doubao-seedream-4-0-250828',
      modelProtocol: 'VOLCENGINE_IMAGE',
      providerName: 'VOLCENGINE',
      apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
      apiToken: 'test-token-not-a-secret',
      extendParam: '{"existingOption":true}',
      imageGenerationConfig: { size: '4K', watermark: false, futureOption: { enabled: true } },
    };
    const saveModelRequest = jest.fn().mockResolvedValue({ data: { id: '42' } });
    const props = {
      open: true,
      type: 'edit' as const,
      data: { id: '42' },
      onCancel: jest.fn(),
      onSaved: jest.fn(),
      loadDetail: jest.fn().mockResolvedValue(detail),
      saveModelRequest,
      runDebugRequest: jest.fn(),
      statusOptions: [{ label: 'Enabled', value: 'ENABLED' }],
    };
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <ConfigProvider theme={{ token: { motion: false } }}>
          <SharedModelFormModal {...props} />
        </ConfigProvider>
      );
    });
    await waitFor(() => expect(screen.getByLabelText('modelMgr.modal.displayName')).toHaveValue('Seedream'));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('modelMgr.modal.displayName'), { target: { value: 'Renamed Seedream' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
    });
    await waitFor(() => expect(saveModelRequest).toHaveBeenCalledTimes(1));
    expect(saveModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Renamed Seedream',
        modelCode: detail.modelCode,
        modelProtocol: detail.modelProtocol,
        extendParam: detail.extendParam,
        imageGenerationConfig: detail.imageGenerationConfig,
      })
    );

    // 复用同一弹窗编辑另一条记录时，不能深合并上一条的 watermark / futureOption。
    props.loadDetail.mockResolvedValue({
      ...detail,
      id: '43',
      displayName: 'Second model',
      imageGenerationConfig: { size: '2K' },
      extendParam: undefined,
    });
    saveModelRequest.mockClear();
    await act(async () => {
      view!.rerender(
        <ConfigProvider theme={{ token: { motion: false } }}>
          <SharedModelFormModal {...props} data={{ id: '43' }} />
        </ConfigProvider>
      );
    });
    await waitFor(() => expect(screen.getByLabelText('modelMgr.modal.displayName')).toHaveValue('Second model'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
    });
    await waitFor(() => expect(saveModelRequest).toHaveBeenCalledTimes(1));
    expect(saveModelRequest.mock.calls[0][0].imageGenerationConfig).toEqual({ size: '2K' });
    expect(saveModelRequest.mock.calls[0][0].extendParam).toBeUndefined();
  }, 15000);
});
