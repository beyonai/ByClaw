import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { getByParamGroupCode } from '@/pages/manager/service/System';
import SharedModelFormModal from '../SharedModelFormModal';

const mockIntl = { locale: 'zh-CN', formatMessage: ({ id }: { id: string }) => id };

jest.mock('@umijs/max', () => ({
  useIntl: () => mockIntl,
  getLocale: () => 'zh-CN',
}));
jest.mock('@/pages/manager/service/System', () => ({ getByParamGroupCode: jest.fn() }));
jest.mock('../ModelDebugPanel', () => () => <div />);

// 使用真实表单、字典加载与下拉交互；只延长此完整流程，避免 CI 并发时触及默认 5 秒上限。
it('loads ASR providers from the server and applies the selected provider connection and options', async () => {
  const asrProviders = [
    {
      paramName: '火山引擎',
      paramEnName: 'Volcengine',
      paramValue: 'VOLCENGINE',
      paramDesc: JSON.stringify({
        modelProtocol: 'VOLCENGINE_ASR_FLASH',
        apiEndpoint: 'https://speech.example.test/asr',
        modelCode: 'bigmodel',
        options: { resourceId: 'volc.bigasr.auc_turbo' },
      }),
    },
  ];
  (getByParamGroupCode as jest.Mock).mockImplementation(({ paramGroupCode }) =>
    Promise.resolve({
      data: { byaiSystemConfigLists: paramGroupCode === 'SYSTEM_MODEL_ASR_PROVIDER_NAME' ? asrProviders : [] },
    })
  );
  await act(async () => {
    render(
      <ConfigProvider virtual={false} theme={{ token: { motion: false } }}>
        <SharedModelFormModal
          open
          type="add"
          data={{}}
          onCancel={jest.fn()}
          onSaved={jest.fn()}
          loadDetail={jest.fn()}
          saveModelRequest={jest.fn()}
          runDebugRequest={jest.fn()}
          statusOptions={[]}
          showTags={false}
        />
      </ConfigProvider>
    );
  });

  await act(async () => {
    fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.modelType'));
  });
  const asrOption = await screen.findByRole('option', { name: 'modelMgr.modal.modelTypeASR' });
  await act(async () => {
    fireEvent.click(asrOption);
  });
  await waitFor(() =>
    expect(getByParamGroupCode).toHaveBeenCalledWith({ paramGroupCode: 'SYSTEM_MODEL_ASR_PROVIDER_NAME' })
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'modelMgr.modal.moreConfig' }));
  });
  await act(async () => {
    fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.provider'));
  });
  const providerOption = await screen.findByRole('option', { name: '火山引擎' });
  await act(async () => {
    fireEvent.click(providerOption);
  });

  await waitFor(() =>
    expect(screen.getByLabelText('modelMgr.modal.apiEndpoint')).toHaveValue('https://speech.example.test/asr')
  );
  expect(screen.getByLabelText('modelMgr.modal.modelCode')).toHaveValue('bigmodel');
  expect(screen.getByLabelText('modelMgr.modal.extendParam')).toHaveValue(
    JSON.stringify({ resourceId: 'volc.bigasr.auc_turbo' }, null, 2)
  );
  expect(screen.getByText('VOLCENGINE_ASR_FLASH')).toBeInTheDocument();
  expect(screen.queryByLabelText('modelMgr.modal.temperature')).not.toBeInTheDocument();
}, 15000);
