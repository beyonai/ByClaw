import { act, render } from '@testing-library/react';
import ModelFormModal from './ModelFormModal';

const mockGetSourceSystemList = jest.fn();
const mockGetDcSystemConfigListByStandType = jest.fn();
let mockSharedModelFormProps: any;

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
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
}));

describe('models/components/ModelFormModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSharedModelFormProps = undefined;
  });

  it('loads ability and system tag options for the personal model form', async () => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({
      data: [{ paramName: '对话模型', paramValue: '3' }],
    });
    mockGetSourceSystemList.mockResolvedValue({
      data: [{ systemName: 'ByClaw', systemCode: 'BY_CLAW' }],
    });

    render(<ModelFormModal open type="add" onCancel={jest.fn()} onSaved={jest.fn()} />);

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
});
