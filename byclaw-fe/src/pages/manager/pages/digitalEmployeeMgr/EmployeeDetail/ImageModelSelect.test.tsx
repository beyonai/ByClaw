import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getModelListByPage } from '@/pages/manager/service/ModelMgr';
import ImageModelSelect from './ImageModelSelect';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) =>
      ({
        'employeeDetail.imageModel': '文生图模型',
        'employeeDetail.imageModelGlobalDefault': '跟随全局默认',
        'employeeDetail.imageModelPlaceholder': '请选择文生图模型',
        'employeeDetail.imageModelLoadError': '文生图模型加载失败',
        'employeeDetail.imageModelRetry': '重试',
      })[id] || id,
  }),
}));

jest.mock('@/pages/manager/service/ModelMgr', () => ({
  getModelListByPage: jest.fn(),
}));

const mockGetModelListByPage = getModelListByPage as jest.MockedFunction<typeof getModelListByPage>;

describe('ImageModelSelect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetModelListByPage.mockResolvedValue({
      code: 0,
      data: {
        rows: [
          {
            id: '9007199254740993',
            displayName: 'Image Pro',
            modelType: 'IMAGE_GENERATION',
            status: 'ENABLED',
          },
          {
            modelId: '2',
            modelName: 'Disabled Image',
            modelType: 'IMAGE_GENERATION',
            status: 'DISABLED',
          },
        ],
      },
    } as never);
  });

  it('loads enabled image-generation models with the required paging filter', async () => {
    render(<ImageModelSelect value={undefined} onChange={jest.fn()} />);

    await waitFor(() => {
      expect(mockGetModelListByPage).toHaveBeenCalledWith({
        modelType: 'IMAGE_GENERATION',
        status: 'ENABLED',
        pageNum: 1,
        pageSize: 1000,
      });
    });

    fireEvent.mouseDown(screen.getByRole('combobox'));
    expect(await screen.findByText('Image Pro')).toBeInTheDocument();
    expect(screen.queryByText('Disabled Image')).not.toBeInTheDocument();
    expect(screen.getAllByText('跟随全局默认').length).toBeGreaterThan(0);
  });

  it('emits undefined for the global default and preserves a large selected ID string', async () => {
    const onChange = jest.fn();
    const { rerender } = render(<ImageModelSelect value={undefined} onChange={onChange} />);

    await waitFor(() => expect(mockGetModelListByPage).toHaveBeenCalledTimes(1));
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('Image Pro'));
    expect(onChange).toHaveBeenLastCalledWith('9007199254740993');

    rerender(<ImageModelSelect value="9007199254740993" onChange={onChange} />);
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getAllByText('跟随全局默认').at(-1) as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('disables the selector, keeps the current edit value, and offers retry on a business failure', async () => {
    mockGetModelListByPage.mockResolvedValueOnce({ code: 50010, msg: 'server rejected the request' });

    render(<ImageModelSelect value="9007199254740993" onChange={jest.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('文生图模型加载失败');
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByText('9007199254740993')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeInTheDocument();
  });

  it('retries after a network failure and re-enables the selector after a successful response', async () => {
    mockGetModelListByPage.mockRejectedValueOnce(new Error('offline'));

    render(<ImageModelSelect value="9007199254740993" onChange={jest.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('文生图模型加载失败');
    expect(screen.getByRole('combobox')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));

    await waitFor(() => expect(mockGetModelListByPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('combobox')).not.toBeDisabled();
    fireEvent.mouseDown(screen.getByRole('combobox'));
    expect((await screen.findAllByText('Image Pro')).length).toBeGreaterThan(0);
  });
});
