import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ModelHealthNotice from '..';
import { checkModelHealth, MODEL_HEALTH_EVENT, updateModelHealthNotice } from '@/service/modelHealth';

const mockNavigate = jest.fn();
jest.mock('@umijs/max', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/chat' }),
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values: Record<string, any> = {}) =>
      (require('@/locales/en-US/manager').default[id] || id).replace(/\{(\w+)\}/g, (_, key) => `${values[key]}`),
    formatTime: () => '12:30',
  }),
}));
jest.mock('@/service/modelHealth', () => ({
  ...jest.requireActual('@/service/modelHealth'),
  checkModelHealth: jest.fn(),
  updateModelHealthNotice: jest.fn(),
}));
jest.mock('@/service/common/request', () => ({ POST: jest.fn() }));
jest.mock('@/utils/auth', () => ({ getAuthSnapshot: () => ({}), isCurrentAuthSnapshot: () => true }));
const check = checkModelHealth as jest.Mock;
const user = { userId: 17, userCode: 'alice' };
const report = {
  scope: 'PERSONAL',
  checkedAt: 1000,
  healthy: false,
  models: [
    {
      modelId: '42',
      modelName: 'My DeepSeek',
      modelType: 'LLM',
      status: 'FAILED',
      errorCode: 'AUTH_FAILED',
      endpoint: 'https://provider.example',
      httpStatus: 401,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  check.mockResolvedValue(report);
});

it('shows a named actionable failure, navigates to the personal tab and reveals safe details on demand', async () => {
  render(<ModelHealthNotice user={user} />);
  expect(await screen.findByText('My DeepSeek')).toBeInTheDocument();
  expect(screen.getByText(/Authentication was rejected/)).toBeInTheDocument();
  expect(mockNavigate).toHaveBeenCalledWith('/models?tab=mine&healthModelId=42');
  expect(screen.queryByText('https://provider.example')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Show details'));
  expect(screen.getByText('https://provider.example')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Edit configuration'));
  expect(mockNavigate).toHaveBeenLastCalledWith(
    '/models?tab=mine&healthModelId=42',
    expect.objectContaining({
      state: expect.objectContaining({ editModelId: '42' }),
    })
  );
});

it('routes an administrator to the public model without an edit action until configuration is clicked', async () => {
  check.mockResolvedValue({ ...report, scope: 'PUBLIC' });
  render(<ModelHealthNotice user={{ ...user, userCode: 'adminvip' }} />);
  await screen.findByText('My DeepSeek');
  expect(mockNavigate).toHaveBeenCalledWith('/manager/systemParams/modal?healthModelId=42');
  expect(mockNavigate.mock.calls.every((call) => !call[1]?.state?.editModelId)).toBe(true);
  fireEvent.click(screen.getByText('View affected models'));
  expect(mockNavigate).toHaveBeenLastCalledWith('/manager/systemParams/modal?healthModelId=42');
  fireEvent.click(screen.getByText('Edit configuration'));
  expect(mockNavigate).toHaveBeenLastCalledWith(
    '/manager/systemParams/modal?healthModelId=42',
    expect.objectContaining({
      state: expect.objectContaining({ editModelId: '42' }),
    })
  );
});

it('is silent on success, and removes the warning after a successful manual retry', async () => {
  const { rerender } = render(<ModelHealthNotice user={user} />);
  await screen.findByRole('alert');
  check.mockResolvedValue({ ...report, healthy: true, models: [] });
  fireEvent.click(screen.getByText('Check again'));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(check).toHaveBeenLastCalledWith(user, { force: true, modelId: '42', scope: 'PERSONAL' });
  mockNavigate.mockClear();
  rerender(<ModelHealthNotice user={{ ...user, userId: 18 }} />);
  await waitFor(() => expect(check).toHaveBeenCalledTimes(3));
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('dismisses the warning and persists the dismissal', async () => {
  render(<ModelHealthNotice user={user} />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss this notice' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(updateModelHealthNotice).toHaveBeenLastCalledWith(user, report, true);
});

it('opens the newly saved failing model instead of the first older failure', async () => {
  render(<ModelHealthNotice user={user} />);
  await screen.findByRole('alert');
  mockNavigate.mockClear();
  act(() =>
    window.dispatchEvent(
      new CustomEvent(MODEL_HEALTH_EVENT, {
        detail: {
          userId: user.userId,
          report: {
            ...report,
            focusModelId: '43',
            models: [...report.models, { ...report.models[0], modelId: '43', modelName: 'Saved Anthropic' }],
          },
        },
      })
    )
  );
  expect(mockNavigate).toHaveBeenLastCalledWith('/models?tab=mine&healthModelId=43');
  expect(screen.getByText('Saved Anthropic')).toBeInTheDocument();
});

it('updates after a deletion or successful save without redirecting to an unrelated older failure', async () => {
  render(<ModelHealthNotice user={user} />);
  await screen.findByRole('alert');
  mockNavigate.mockClear();
  act(() =>
    window.dispatchEvent(
      new CustomEvent(MODEL_HEALTH_EVENT, {
        detail: { userId: user.userId, report: { ...report, checkedAt: 2000, presented: true } },
      })
    )
  );
  expect(screen.getByText('My DeepSeek')).toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();
  act(() =>
    window.dispatchEvent(
      new CustomEvent(MODEL_HEALTH_EVENT, {
        detail: { userId: user.userId, report: { ...report, healthy: true, models: [], presented: true } },
      })
    )
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('does not present a global notice when a chat model picker only reads cached health', async () => {
  check.mockResolvedValue({ ...report, healthy: true, models: [] });
  render(<ModelHealthNotice user={user} />);
  await waitFor(() => expect(check).toHaveBeenCalled());
  mockNavigate.mockClear();
  act(() =>
    window.dispatchEvent(
      new CustomEvent(MODEL_HEALTH_EVENT, {
        detail: { userId: user.userId, silent: true, report },
      })
    )
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();
});
