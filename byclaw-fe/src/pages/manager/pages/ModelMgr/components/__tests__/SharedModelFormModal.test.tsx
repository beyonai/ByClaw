import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getByParamGroupCode } from '@/pages/manager/service/System';
import SharedModelFormModal from '../SharedModelFormModal';

const mockIntl = { locale: 'zh-CN', formatMessage: ({ id }: { id: string }) => id };

jest.mock('@umijs/max', () => ({
  useIntl: () => mockIntl,
  getLocale: () => 'zh-CN',
}));
jest.mock('@/pages/manager/service/System', () => ({ getByParamGroupCode: jest.fn() }));
jest.mock('../ModelDebugPanel', () => () => <div />);

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
  render(
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
  );

  fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.modelType'));
  fireEvent.click(await screen.findByText('modelMgr.modal.modelTypeASR'));
  await waitFor(() =>
    expect(getByParamGroupCode).toHaveBeenCalledWith({ paramGroupCode: 'SYSTEM_MODEL_ASR_PROVIDER_NAME' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'modelMgr.modal.moreConfig' }));
  fireEvent.mouseDown(screen.getByLabelText('modelMgr.modal.provider'));
  fireEvent.click(await screen.findByText('火山引擎'));

  await waitFor(() =>
    expect(screen.getByLabelText('modelMgr.modal.apiEndpoint')).toHaveValue('https://speech.example.test/asr')
  );
  expect(screen.getByLabelText('modelMgr.modal.modelCode')).toHaveValue('bigmodel');
  expect(screen.getByLabelText('modelMgr.modal.extendParam')).toHaveValue(
    JSON.stringify({ resourceId: 'volc.bigasr.auc_turbo' }, null, 2)
  );
  expect(screen.getByText('VOLCENGINE_ASR_FLASH')).toBeInTheDocument();
  expect(screen.queryByLabelText('modelMgr.modal.temperature')).not.toBeInTheDocument();
});
