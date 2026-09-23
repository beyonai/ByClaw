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

const renderForm = (type: 'add' | 'edit' = 'add') => {
  render(<ModelFormModal open type={type} onCancel={jest.fn()} onSaved={jest.fn()} />);
  return mockSharedModelFormProps;
};

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

  it.each(['add', 'edit'] as const)('enables dictionary loading for %s forms', async (type) => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({
      data: [{ paramName: '图片理解', paramValue: '3' }],
    });
    const props = renderForm(type);

    // 共享弹窗仅在 showTags 和加载回调同时存在时发起请求。
    expect(props.showTags).toBe(true);
    await expect(props.loadAbilityOptions()).resolves.toEqual([{ label: '图片理解', value: '3' }]);
    expect(mockGetDcSystemConfigListByStandType).toHaveBeenCalledWith({ standType: 'MODEL_TAGS' });
  });

  it('supports legacy dictionary fields and skips empty codes', async () => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({
      data: [
        { standDisplayValue: ' 推理 ', standCode: 4 },
        { param_name: ' 语音 ', param_value: ' 6 ' },
        { paramValue: '5' },
        { paramName: '无效选项', paramValue: ' ' },
      ],
    });
    await expect(renderForm().loadAbilityOptions()).resolves.toEqual([
      { label: '推理', value: '4' },
      { label: '语音', value: '6' },
      { label: '5', value: '5' },
    ]);
  });

  it.each([undefined, null, {}, []])('handles missing or empty dictionary data: %p', async (data) => {
    mockGetDcSystemConfigListByStandType.mockResolvedValue({ data });
    await expect(renderForm().loadAbilityOptions()).resolves.toEqual([]);
  });

  it('propagates request failures to the shared form error handler', async () => {
    mockGetDcSystemConfigListByStandType.mockRejectedValue(new Error('dictionary unavailable'));
    await expect(renderForm().loadAbilityOptions()).rejects.toThrow('dictionary unavailable');
  });
});
