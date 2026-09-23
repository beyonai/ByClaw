import React from 'react';
import { render } from '@testing-library/react';
import SharedModelFormModal from '@/pages/manager/pages/ModelMgr/components/SharedModelFormModal';
import { getDcSystemConfigListByStandType } from '@/pages/manager/service/session';
import ModelFormModal from './ModelFormModal';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/pages/manager/pages/ModelMgr/components/SharedModelFormModal', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));
jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfigListByStandType: jest.fn() }));
jest.mock('../service', () => ({ getMyModelDetail: jest.fn(), upsertMyModel: jest.fn() }));

const renderForm = (type: 'add' | 'edit' = 'add') => {
  render(<ModelFormModal open type={type} onCancel={jest.fn()} onSaved={jest.fn()} />);
  const calls = (SharedModelFormModal as jest.Mock).mock.calls;
  return calls[calls.length - 1][0];
};

describe('resource center model ability dictionary', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['add', 'edit'] as const)('enables dictionary loading for %s forms', async (type) => {
    (getDcSystemConfigListByStandType as jest.Mock).mockResolvedValue({
      data: [{ paramName: '图片理解', paramValue: '3' }],
    });
    const props = renderForm(type);

    // 共享弹窗仅在 showTags 和加载回调同时存在时发起请求。
    expect(props.showTags).toBe(true);
    await expect(props.loadAbilityOptions()).resolves.toEqual([{ label: '图片理解', value: '3' }]);
    expect(getDcSystemConfigListByStandType).toHaveBeenCalledWith({ standType: 'MODEL_TAGS' });
  });

  it('supports legacy dictionary fields and skips empty codes', async () => {
    (getDcSystemConfigListByStandType as jest.Mock).mockResolvedValue({
      data: [
        { standDisplayValue: ' 推理 ', standCode: 4 },
        { paramValue: '5' },
        { paramName: '无效选项', paramValue: ' ' },
      ],
    });
    await expect(renderForm().loadAbilityOptions()).resolves.toEqual([
      { label: '推理', value: '4' },
      { label: '5', value: '5' },
    ]);
  });

  it.each([undefined, null, {}, []])('handles missing or empty dictionary data: %p', async (data) => {
    (getDcSystemConfigListByStandType as jest.Mock).mockResolvedValue({ data });
    await expect(renderForm().loadAbilityOptions()).resolves.toEqual([]);
  });

  it('propagates request failures to the shared form error handler', async () => {
    (getDcSystemConfigListByStandType as jest.Mock).mockRejectedValue(new Error('dictionary unavailable'));
    await expect(renderForm().loadAbilityOptions()).rejects.toThrow('dictionary unavailable');
  });
});
