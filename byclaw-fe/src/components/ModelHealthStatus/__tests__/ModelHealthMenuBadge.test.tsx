import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { POST } from '@/service/common/request';
import { refreshCachedModelHealth } from '@/service/modelHealth';
import ModelHealthMenuBadge from '../ModelHealthMenuBadge';

const user = { userId: 717, userCode: 'alice' };
jest.mock('@umijs/max', () => ({
  useSelector: (select: any) => select({ user: { userInfo: user } }),
  useLocation: () => ({ pathname: '/resourceCenter', search: '?resourceTab=model' }),
  useIntl: () => ({ formatMessage: (_: any, values: any) => `${values.count} models failed` }),
}));
jest.mock('@/service/common/request', () => ({ POST: jest.fn() }));
jest.mock('@/utils/auth', () => ({ getAuthSnapshot: () => ({}), isCurrentAuthSnapshot: () => true }));

it('shows 3 for personal 1 + public 2, then hides at zero after a cache-only Redis refresh', async () => {
  const reports: Record<string, any> = {
    PERSONAL: { scope: 'PERSONAL', checkedAt: 1, models: [{ modelId: '1', status: 'FAILED' }] },
    PUBLIC: {
      scope: 'PUBLIC',
      checkedAt: 1,
      models: [
        { modelId: '2', status: 'FAILED' },
        { modelId: '3', status: 'FAILED' },
      ],
    },
  };
  (POST as jest.Mock).mockImplementation(async (url, { scope }) => ({ code: 0, data: reports[scope] }));
  const { container } = render(<ModelHealthMenuBadge />);
  expect(await screen.findByText('3')).toBeInTheDocument();
  expect(container.querySelector('.ant-badge-count-sm')).toBeInTheDocument();
  reports.PERSONAL = { ...reports.PERSONAL, checkedAt: 2, models: [] };
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
  reports.PUBLIC = { ...reports.PUBLIC, checkedAt: 2, models: [] };
  await act(async () => {
    await refreshCachedModelHealth(user, 'PUBLIC');
  });
  await waitFor(() => expect(container.querySelector('.ant-badge-count')).not.toBeInTheDocument());
  expect((POST as jest.Mock).mock.calls.every(([url]) => url.endsWith('/healthCache'))).toBe(true);
});
