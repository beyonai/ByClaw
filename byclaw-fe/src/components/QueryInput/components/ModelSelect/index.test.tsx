import { act, render, waitFor } from '@testing-library/react';

import { getMyModels, getPublicModels } from '@/pages/models/service';
import ModelSelect, { reasoningLabelStrideFor } from '.';

let mockUserInfo: Record<string, unknown> | null = null;

jest.mock('@umijs/max', () => ({
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
  Select: () => null,
  Slider: () => null,
  Spin: () => null,
  Tabs: () => null,
  Tag: ({ children }: { children: React.ReactNode }) => children,
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

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
