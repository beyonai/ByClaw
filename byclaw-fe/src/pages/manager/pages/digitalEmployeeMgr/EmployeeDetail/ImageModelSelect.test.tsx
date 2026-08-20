import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getPersonalModelList, getPublicModelList } from '@/pages/manager/service/ModelMgr';
import ImageModelSelect from './ImageModelSelect';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) =>
      ({
        'employeeDetail.imageModel': '文生图模型',
        'employeeDetail.imageModelConfiguration': '文生图模型配置',
        'employeeDetail.imageModelGlobalDefault': '跟随全局默认',
        'employeeDetail.imageModelLoadError': '文生图模型加载失败',
        'employeeDetail.imageModelRetry': '重试',
        'modelPopover.mine': '我的',
        'modelPopover.public': '公共',
        'modelPopover.noModels': '暂无模型',
        'modelPopover.confirm': '确定',
      }[id] || id),
  }),
}));

jest.mock('@/pages/manager/service/ModelMgr', () => ({
  getPersonalModelList: jest.fn(),
  getPublicModelList: jest.fn(),
}));

const mockGetPersonalModelList = getPersonalModelList as jest.MockedFunction<typeof getPersonalModelList>;
const mockGetPublicModelList = getPublicModelList as jest.MockedFunction<typeof getPublicModelList>;

const personalModelsResponse = {
  code: 0,
  data: {
    rows: [
      {
        id: '9007199254740993',
        displayName: 'My Image Pro',
        modelType: 'IMAGE_GENERATION',
        status: 'ENABLED',
      },
    ],
  },
};

const publicModelsResponse = {
  code: 0,
  data: {
    rows: [
      {
        modelId: '2',
        modelName: 'Public Image Pro',
        modelType: 'IMAGE_GENERATION',
        status: 'ENABLED',
      },
      {
        modelId: '3',
        modelName: 'Disabled Image',
        modelType: 'IMAGE_GENERATION',
        status: 'DISABLED',
      },
    ],
  },
};

describe('ImageModelSelect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPersonalModelList.mockResolvedValue(personalModelsResponse as never);
    mockGetPublicModelList.mockResolvedValue(publicModelsResponse as never);
  });

  it('loads enabled image-generation models from personal and public scopes', async () => {
    render(<ImageModelSelect value={undefined} onChange={jest.fn()} />);

    await waitFor(() => {
      expect(mockGetPersonalModelList).toHaveBeenCalledWith({
        modelType: 'IMAGE_GENERATION',
        status: 'ENABLED',
        pageNum: 1,
        pageSize: 1000,
      });
      expect(mockGetPublicModelList).toHaveBeenCalledWith({
        modelType: 'IMAGE_GENERATION',
        status: 'ENABLED',
        pageNum: 1,
        pageSize: 1000,
      });
    });

    const imageModelButton = screen.getByRole('button', { name: '文生图模型' });
    await waitFor(() => expect(imageModelButton).not.toBeDisabled());
    fireEvent.click(imageModelButton);
    expect(await screen.findByText('Public Image Pro')).toBeInTheDocument();
    expect(screen.queryByText('Disabled Image')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '我的' }));
    expect(await screen.findByText('My Image Pro')).toBeInTheDocument();
  });

  it('emits the selected model ID and clears it for the global default', async () => {
    const onChange = jest.fn();
    const { rerender } = render(<ImageModelSelect value={undefined} onChange={onChange} />);

    await waitFor(() => expect(mockGetPublicModelList).toHaveBeenCalledTimes(1));
    const imageModelButton = screen.getByRole('button', { name: '文生图模型' });
    await waitFor(() => expect(imageModelButton).not.toBeDisabled());
    fireEvent.click(imageModelButton);
    fireEvent.click(await screen.findByText('Public Image Pro'));
    expect(onChange).toHaveBeenLastCalledWith('2');

    rerender(<ImageModelSelect value="2" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('跟随全局默认'));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('disables the selector, keeps the current edit value, and offers retry on a business failure', async () => {
    mockGetPersonalModelList.mockResolvedValueOnce({ code: 50010, msg: 'server rejected the request' } as never);

    render(<ImageModelSelect value="9007199254740993" onChange={jest.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('文生图模型加载失败');
    expect(screen.getByRole('button', { name: '文生图模型' })).toBeDisabled();
    expect(screen.getByText('9007199254740993')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeInTheDocument();
  });

  it('retries after a network failure and re-enables the selector after a successful response', async () => {
    mockGetPersonalModelList.mockRejectedValueOnce(new Error('offline'));

    render(<ImageModelSelect value="9007199254740993" onChange={jest.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('文生图模型加载失败');
    expect(screen.getByRole('button', { name: '文生图模型' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));

    await waitFor(() => {
      expect(mockGetPersonalModelList).toHaveBeenCalledTimes(2);
      expect(mockGetPublicModelList).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '文生图模型' })).not.toBeDisabled();
  });
});
