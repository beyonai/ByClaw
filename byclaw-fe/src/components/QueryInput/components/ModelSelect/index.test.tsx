import { act, render, screen, waitFor } from '@testing-library/react';

import { getMyModels, getPublicModels } from '@/pages/models/service';
import ModelSelect, { reasoningLabelStrideFor } from '.';
import useCachedModelHealth from '@/hooks/useCachedModelHealth';

let mockUserInfo: Record<string, unknown> | null = null;

jest.mock('@umijs/max', () => ({
  getIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl('zh-CN'),
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useSelector: (selector: (state: unknown) => unknown) => selector({ user: { userInfo: mockUserInfo } }),
}));

jest.mock('@ant-design/icons', () => ({
  AppstoreOutlined: () => null,
  CloudOutlined: () => null,
  LaptopOutlined: () => null,
  UserOutlined: () => null,
}));

jest.mock('antd', () => ({
  Empty: () => null,
  Select: ({ status }: any) => <div data-testid="model-select" data-status={status} />,
  Slider: () => null,
  Spin: () => null,
  Tabs: () => null,
  Tag: ({ children }: { children: React.ReactNode }) => children,
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('./ModelHealthWarning', () => () => null);
jest.mock('@/hooks/useCachedModelHealth', () => ({ __esModule: true, default: jest.fn() }));

jest.mock('@/pages/models/service', () => ({
  getMyModels: jest.fn(),
  getPublicModels: jest.fn(),
}));

const mockGetMyModels = getMyModels as jest.MockedFunction<typeof getMyModels>;
const mockGetPublicModels = getPublicModels as jest.MockedFunction<typeof getPublicModels>;

describe('ModelSelect authentication loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserInfo = null;
    mockGetMyModels.mockResolvedValue({ code: 0, msg: '', data: { rows: [], total: 0 } });
    mockGetPublicModels.mockResolvedValue({ code: 0, msg: '', data: { rows: [], total: 0 } });
  });

  it('waits for web login and loads models as soon as the user becomes authenticated', async () => {
    const view = render(<ModelSelect allowWeb onChange={jest.fn()} />);

    expect(mockGetMyModels).not.toHaveBeenCalled();
    expect(mockGetPublicModels).not.toHaveBeenCalled();

    mockUserInfo = { userId: 27, sessionId: 'session-after-login' };
    await act(async () => {
      view.rerender(<ModelSelect allowWeb onChange={jest.fn()} />);
    });

    await waitFor(() => {
      expect(mockGetMyModels).toHaveBeenCalledTimes(1);
      expect(mockGetPublicModels).toHaveBeenCalledTimes(1);
    });
  });
});

describe('cached model selection warnings', () => {
  const failure = { modelId: 'mine-failed', status: 'FAILED' };
  const cached = useCachedModelHealth as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserInfo = { userId: 27 };
    mockGetMyModels.mockResolvedValue({
      code: 0,
      data: {
        rows: [
          { id: 'mine-failed', modelName: 'My model' },
          { id: 'mine-healthy', modelName: 'Healthy model' },
        ],
      },
    } as any);
    mockGetPublicModels.mockResolvedValue({
      code: 0,
      data: { rows: [{ id: 'public-failed', modelName: 'Shared model' }] },
    } as any);
    cached.mockReturnValue({ models: [failure] });
  });

  it('marks a failed selection red and clears red after recovery', async () => {
    const view = render(<ModelSelect allowWeb value="mine-failed" onChange={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId('model-select')).toHaveAttribute('data-status', 'error'));

    cached.mockReturnValue({ models: [{ ...failure, status: 'HEALTHY' }] });
    view.rerender(<ModelSelect allowWeb value="mine-failed" onChange={jest.fn()} />);
    expect(screen.getByTestId('model-select')).not.toHaveAttribute('data-status');
  });

  it('clears red when switching to a healthy or default model and uses the public scope for public models', async () => {
    const view = render(<ModelSelect allowWeb value="mine-failed" onChange={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId('model-select')).toHaveAttribute('data-status', 'error'));
    view.rerender(<ModelSelect allowWeb value="mine-healthy" onChange={jest.fn()} />);
    expect(screen.getByTestId('model-select')).not.toHaveAttribute('data-status');
    view.rerender(<ModelSelect allowWeb value="-1" onChange={jest.fn()} />);
    expect(screen.getByTestId('model-select')).not.toHaveAttribute('data-status');

    cached.mockReturnValue({ models: [{ ...failure, modelId: 'public-failed' }] });
    view.rerender(<ModelSelect allowWeb value="public-failed" onChange={jest.fn()} />);
    expect(cached).toHaveBeenLastCalledWith(mockUserInfo, 'PUBLIC');
    expect(screen.getByTestId('model-select')).toHaveAttribute('data-status', 'error');
  });
});

describe('reasoning label density', () => {
  const widths = [15, 42, 18, 43, 24, 31, 48, 23];

  it('keeps every label when they fit', () => {
    expect(reasoningLabelStrideFor(480, widths)).toBe(1);
  });

  it('shows every other label when adjacent labels would collide', () => {
    expect(reasoningLabelStrideFor(350, widths)).toBe(2);
  });

  it('increases the regular sampling interval on narrower tracks', () => {
    expect(reasoningLabelStrideFor(160, widths)).toBe(3);
  });
});
