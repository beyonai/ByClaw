import { renderHook, waitFor } from '@testing-library/react';
import { getByParamGroupCode } from '@/pages/manager/service/System';
import useModelTypeOptions from '../useModelTypeOptions';

const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
let mockLocale = 'zh-CN';
jest.mock('@umijs/max', () => ({
  useIntl: () => mockIntl,
  getLocale: () => mockLocale,
}));
jest.mock('@/pages/manager/service/System', () => ({ getByParamGroupCode: jest.fn() }));
const mockLoad = getByParamGroupCode as jest.Mock;

describe('shared model type options', () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockLocale = 'zh-CN';
  });

  it.each(['zh-CN', 'en-US'])('uses dictionary values and labels in %s', async (locale) => {
    mockLocale = locale;
    mockLoad.mockResolvedValue({
      data: {
        byaiSystemConfigLists: [
          { paramValue: 'CUSTOM', paramName: '自定义', paramEnName: 'Custom' },
          { paramValue: 'IMAGE_GENERATION', paramName: '图片', paramEnName: 'Image' },
        ],
      },
    });
    const { result } = renderHook(() => useModelTypeOptions());
    await waitFor(() => expect(result.current[0].value).toBe('CUSTOM'));
    expect(result.current).toEqual([
      { value: 'CUSTOM', label: locale === 'en-US' ? 'Custom' : '自定义' },
      { value: 'IMAGE_GENERATION', label: locale === 'en-US' ? 'Image' : '图片' },
      { value: 'ASR', label: 'modelMgr.modal.modelTypeASR' },
    ]);
    expect(mockLoad).toHaveBeenCalledWith({ paramGroupCode: 'SYSTEM_MODEL_TYPE' });
  });

  it('retains a configured ASR label without adding a duplicate', async () => {
    mockLoad.mockResolvedValue({ data: { byaiSystemConfigLists: [{ paramValue: 'ASR', paramName: '全局语音识别' }] } });
    const { result } = renderHook(() => useModelTypeOptions());
    await waitFor(() => expect(result.current[0].label).toBe('全局语音识别'));
    expect(result.current.filter((item) => item.value === 'ASR')).toEqual([{ value: 'ASR', label: '全局语音识别' }]);
    expect(result.current.some((item) => item.value === 'IMAGE_GENERATION')).toBe(true);
  });

  it('loads on opening and retains fallback options if the request fails', async () => {
    mockLoad.mockRejectedValue(new Error('unavailable'));
    const { result, rerender } = renderHook(({ open }) => useModelTypeOptions(open), {
      initialProps: { open: false },
    });
    expect(mockLoad).not.toHaveBeenCalled();
    rerender({ open: true });
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
    expect(result.current.map((item) => item.value)).toEqual([
      'LLM',
      'RERANK',
      'EMBEDDING',
      'TTS',
      'ASR',
      'IMAGE_GENERATION',
    ]);
  });
});
