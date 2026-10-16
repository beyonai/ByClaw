import { render } from '@testing-library/react';
import ModelFormModal from '../ModelFormModal';
import { getModelListByPage } from '@/pages/manager/service/ModelMgr';

let mockSharedProps: any;
const mockDispatch = jest.fn();
jest.mock('@umijs/max', () => ({
  useDispatch: () => mockDispatch,
  useIntl: () => ({ formatMessage: ({ id }: any) => id }),
}));
jest.mock('../SharedModelFormModal', () => (props: any) => {
  mockSharedProps = props;
  return null;
});
jest.mock('@/pages/manager/service/ModelMgr', () => ({ getModelListByPage: jest.fn() }));
jest.mock('@/pages/manager/service/OrgMgr', () => ({ getSourceSystemList: jest.fn() }));
jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfigListByStandType: jest.fn() }));

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
