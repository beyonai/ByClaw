const mockGetDcSystemConfig = jest.fn();
const mockUseGlobal = jest.fn();

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) =>
      ({
        'chat.bottomContent.suggestQuestion': '推荐问题',
        'chat.bottomContent.suggestReplay': '推荐回放',
        'chat.bottomContent.suggestSkill': '推荐技能',
        'chat.bottomContent.systemNotification': '系统通知',
      }[id] || id),
  }),
  useSelector: (selector: (state: unknown) => unknown) => selector({ user: { userInfo: { userId: 1 } } }),
}));
jest.mock('antd', () => ({
  Tabs: ({ items = [], activeKey }: { items?: Array<{ key?: string; label?: string }>; activeKey?: string }) => (
    <div data-active-key={activeKey} data-testid="bottom-content-tabs">
      {items.map((item) => (
        <span key={item.key}>{item.label}</span>
      ))}
    </div>
  ),
}));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  // 延迟读取 mock，避免 Jest 提升工厂后触发 const 暂时性死区。
  default: (...args: unknown[]) => mockUseGlobal(...args),
}));
jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfig: (...args: unknown[]) => mockGetDcSystemConfig(...args),
}));
jest.mock('./recommendQuestion', () => () => null);
jest.mock('./recommendTabs', () => () => null);
jest.mock('./suggestSkill', () => () => null);
jest.mock('./systemNotification', () => () => null);

import { render, screen, waitFor } from '@testing-library/react';
import BottomContent from './index';

describe('BottomContent brand-specific tabs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseGlobal.mockReturnValue({ agentInfo: {} });
  });

  it('hides recommended questions and system notifications for the commercial brand', async () => {
    mockGetDcSystemConfig.mockResolvedValue({ data: { paramValue: 'commercial' } });

    render(<BottomContent />);

    await waitFor(() => {
      expect(screen.queryByText('推荐问题')).not.toBeInTheDocument();
      expect(screen.queryByText('系统通知')).not.toBeInTheDocument();
      expect(screen.getByText('推荐回放')).toBeInTheDocument();
    });
  });

  it('keeps the two tabs for non-commercial brands', async () => {
    mockGetDcSystemConfig.mockResolvedValue({ paramValue: 'openSource' });

    render(<BottomContent />);

    await waitFor(() => {
      expect(screen.getByText('推荐问题')).toBeInTheDocument();
      expect(screen.getByText('系统通知')).toBeInTheDocument();
    });
  });
});
