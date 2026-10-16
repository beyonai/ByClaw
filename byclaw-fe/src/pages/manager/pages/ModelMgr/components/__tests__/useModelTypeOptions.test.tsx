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
    ]);
    expect(mockLoad).toHaveBeenCalledWith({ paramGroupCode: 'SYSTEM_MODEL_TYPE' });
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
      'LLM', 'RERANK', 'EMBEDDING', 'TTS', 'IMAGE_GENERATION',
    ]);
  });
});
