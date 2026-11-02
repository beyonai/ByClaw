import { POST } from '@/service/common/request';
import { checkModelHealth, getCachedModelHealth } from '@/service/modelHealth';
import { render } from '@testing-library/react';
import ModelFormModal from '../ModelFormModal';
import { getModelListByPage } from '@/pages/manager/service/ModelMgr';

let mockSharedProps: any;
const mockDispatch = jest.fn();
jest.mock('@umijs/max', () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: any) => selector({ user: { userInfo: { userId: 1, userCode: 'adminvip' } } }),
  useIntl: () => ({ formatMessage: ({ id }: any) => id }),
}));
jest.mock('@/service/modelHealth', () => ({
  ...jest.requireActual('@/service/modelHealth'),
  checkModelHealth: jest.fn(),
}));
jest.mock('@/service/common/request', () => ({ POST: jest.fn() }));
jest.mock('@/utils/auth', () => ({ getAuthSnapshot: () => ({}), isCurrentAuthSnapshot: () => true }));
jest.mock('../SharedModelFormModal', () => (props: any) => {
  mockSharedProps = props;
  return null;
});
jest.mock('@/pages/manager/service/ModelMgr', () => ({ getModelListByPage: jest.fn() }));
jest.mock('@/pages/manager/service/OrgMgr', () => ({ getSourceSystemList: jest.fn() }));
jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfigListByStandType: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  (POST as jest.Mock).mockReset();
});

it('does not use saved environment records as official templates', () => {
  (getModelListByPage as jest.Mock).mockResolvedValue({
    code: 0,
    data: { rows: [{ id: 1, modelCode: 'model2', modelType: 'LLM' }], total: 1 },
  });
  render(<ModelFormModal open type="add" onCancel={jest.fn()} reload={jest.fn()} />);
  expect(mockSharedProps).not.toHaveProperty('loadConfiguredPresets');
  expect(getModelListByPage).not.toHaveBeenCalled();
  expect(mockDispatch).not.toHaveBeenCalled();
});

it('records the failed public debug result without issuing another health probe', async () => {
  (POST as jest.Mock).mockResolvedValueOnce({ code: 0, data: 1 }).mockResolvedValueOnce({
    code: 0,
    data: {
      scope: 'PUBLIC',
      checkedAt: Date.now(),
      healthy: false,
      presented: true,
      dismissed: true,
      models: [
        { modelId: '43', modelName: 'Public broken', modelType: 'LLM', status: 'FAILED', errorCode: 'DEBUG_FAILED' },
      ],
    },
  });
  mockDispatch.mockImplementation((action: any) => action.fail({ code: -1, success: false, msg: 'upstream failed' }));
  render(<ModelFormModal open type="edit" onCancel={jest.fn()} reload={jest.fn()} />);
  await expect(
    mockSharedProps.runDebugRequest({ modelId: '43', modelName: 'Public broken', modelType: 'LLM', input: '{}' })
  ).rejects.toMatchObject({ code: -1 });
  expect(getCachedModelHealth({ userId: 1 }, 'PUBLIC')?.models[0]).toMatchObject({
    modelId: '43',
    modelName: 'Public broken',
    status: 'FAILED',
    errorCode: 'DEBUG_FAILED',
  });
  expect(checkModelHealth).not.toHaveBeenCalled();
  expect(mockDispatch).toHaveBeenCalledTimes(1);
});

it('forces the exact saved public model check on every save', async () => {
  mockDispatch.mockImplementation((action: any) => action.success({ id: '42' }));
  render(<ModelFormModal open type="add" onCancel={jest.fn()} reload={jest.fn()} />);
  await mockSharedProps.saveModelRequest({ modelCode: 'test' });
  await mockSharedProps.saveModelRequest({ modelCode: 'test' });
  expect(checkModelHealth).toHaveBeenCalledTimes(2);
  expect(checkModelHealth).toHaveBeenLastCalledWith(
    { userId: 1, userCode: 'adminvip' },
    { modelId: '42', scope: 'PUBLIC', force: true }
  );
});
