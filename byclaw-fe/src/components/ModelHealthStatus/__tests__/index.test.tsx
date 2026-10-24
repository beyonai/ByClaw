import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { POST } from '@/service/common/request';
import {
  checkModelHealth,
  refreshCachedModelHealth,
  removeCachedModelHealth,
  runModelDebugWithHealth,
  type HealthUser,
  type ModelHealthReport,
} from '@/service/modelHealth';
import useCachedModelHealth from '@/hooks/useCachedModelHealth';
import ModelHealthNotice from '@/components/ModelHealthNotice';
import ModelCard from '@/pages/models/components/ModelCard';
import PublicModelCard from '@/pages/models/components/PublicModelCard';
import ModelCardItem from '@/pages/manager/pages/ModelMgr/components/ModelCardItem';
import { ModelHealthBadge, ModelHealthSummary } from '..';

const mockNavigate = jest.fn();
const mockIntl = {
  formatMessage: ({ id }: { id: string }, values: Record<string, any> = {}) =>
    (require('@/locales/en-US/manager').default[id] || id).replace(/\{(\w+)\}/g, (_, key) => `${values[key]}`),
  formatTime: () => '12:30',
};
jest.mock('@umijs/max', () => ({
  useIntl: () => mockIntl,
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/models' }),
}));
jest.mock('@/service/common/request', () => ({ POST: jest.fn() }));
jest.mock('@/utils/auth', () => ({ getAuthSnapshot: () => ({}), isCurrentAuthSnapshot: () => true }));
const user = { userId: 17, userCode: 'alice', enterpriseId: 1 };
const failure = (scope: ModelHealthReport['scope'] = 'PERSONAL'): ModelHealthReport => ({
  scope,
  checkedAt: Date.now(),
  healthy: false,
  models: [
    { modelId: '42', modelName: 'Broken model', modelType: 'LLM', status: 'FAILED', errorCode: 'AUTH_FAILED' },
    { modelId: '43', modelName: 'Another model', modelType: 'LLM', status: 'FAILED', errorCode: 'CONNECTION_FAILED' },
  ],
});

const reports: Partial<Record<ModelHealthReport['scope'], ModelHealthReport>> = {};
let loginScope: ModelHealthReport['scope'] = 'PERSONAL';
async function seed(report = failure(), owner = user) {
  reports[report.scope] = { ...report, presented: true, dismissed: true };
  loginScope = owner.userCode === 'adminvip' ? 'PUBLIC' : 'PERSONAL';
  return refreshCachedModelHealth(owner, report.scope);
}
function expectNoProbe() {
  expect((POST as jest.Mock).mock.calls.some(([url]) => url.endsWith('/healthCheck'))).toBe(false);
}

function Page({
  owner = user,
  scope = 'PERSONAL',
  card = 'personal',
  combined = false,
}: {
  owner?: HealthUser;
  scope?: ModelHealthReport['scope'];
  card?: 'personal' | 'readonly' | 'manager';
  combined?: boolean;
}) {
  const personal = useCachedModelHealth(owner, 'PERSONAL');
  const publicReport = useCachedModelHealth(owner, 'PUBLIC');
  const report = scope === 'PERSONAL' ? personal : publicReport;
  const badge = <ModelHealthBadge user={owner} report={report} modelId="42" />;
  const record = { id: '42', displayName: 'Listed model', modelType: 'LLM' };
  return (
    <>
      <ModelHealthSummary user={owner} report={report} reports={combined ? [personal, publicReport] : undefined} />
      {card === 'personal' && (
        <ModelCard data={record} onEdit={jest.fn()} onDebug={jest.fn()} onDelete={jest.fn()} healthIndicator={badge} />
      )}
      {card === 'readonly' && <PublicModelCard record={record} healthIndicator={badge} />}
      {card === 'manager' && (
        <ModelCardItem
          intl={mockIntl}
          record={record}
          abilityLabelMap={{}}
          onEdit={jest.fn()}
          onDebug={jest.fn()}
          onDelete={jest.fn()}
          onSetStatus={jest.fn()}
          onSetDefault={jest.fn()}
          healthIndicator={badge}
        />
      )}
      <ModelHealthNotice user={owner} />
    </>
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  delete reports.PERSONAL;
  delete reports.PUBLIC;
  loginScope = 'PERSONAL';
  (POST as jest.Mock).mockImplementation(async (url, params) => {
    if (url.endsWith('/healthCache'))
      return { code: 0, data: reports[params.scope as ModelHealthReport['scope']] || null };
    if (url.endsWith('/healthCheck')) return { code: 0, data: reports[loginScope] || null };
    if (url.endsWith('/healthNotice')) return { code: 0, data: true };
    if (url.endsWith('/healthRemoveDeleted')) {
      for (const scope of ['PERSONAL', 'PUBLIC'] as const) {
        if (!reports[scope]) continue;
        const models = reports[scope]!.models.filter((item) => item.modelId !== params.id);
        reports[scope] = { ...reports[scope]!, models, healthy: !models.some((item) => item.status === 'FAILED') };
      }
      return { code: 0, data: true };
    }
    return { code: 0, data: null };
  });
  await refreshCachedModelHealth(user, 'PERSONAL');
  await refreshCachedModelHealth(user, 'PUBLIC');
  (POST as jest.Mock).mockClear();
});

it.each(['personal', 'readonly', 'manager'] as const)(
  'loads Redis failures in the %s card and opens precise dismissed diagnostics without probing',
  async (card) => {
    const scope = card === 'personal' ? 'PERSONAL' : 'PUBLIC';
    const owner = card === 'personal' ? user : { ...user, userCode: 'adminvip' };
    await seed(failure(scope), owner);
    render(<Page card={card} scope={scope} owner={owner} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      `Last check: 2 issue(s) in ${scope === 'PERSONAL' ? 'Personal models' : 'Public models'}`
    );
    fireEvent.click(screen.getByRole('button', { name: 'View check details for Broken model' }));
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('Broken model');
    expect(notice).not.toHaveTextContent('Another model');
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this notice' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Last check failed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('View issue details'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Another model'));
    expectNoProbe();
  }
);

it('keeps all 3 failures across tabs and refreshes a repair made on another device from Redis', async () => {
  await seed({ ...failure(), models: failure().models.slice(0, 1) });
  await seed(failure('PUBLIC'));
  const view = render(<Page combined />);
  expect(screen.getByRole('status')).toHaveTextContent('Last check: 3 issue(s) in total');
  fireEvent.click(screen.getByRole('button', { name: 'Personal models: 1 issue(s) · View details' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Personal models'));
  view.rerender(<Page combined scope="PUBLIC" card="readonly" />);
  expect(screen.getByRole('status')).toHaveTextContent('Last check: 3 issue(s) in total');
  fireEvent.click(screen.getByRole('button', { name: 'Public models: 2 issue(s) · View details' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Another model'));
  reports.PUBLIC = { ...failure('PUBLIC'), models: failure('PUBLIC').models.slice(0, 1), dismissed: true };
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Last check: 2 issue(s) in total'));
  expectNoProbe();
});

it('counts only the 2 public issues on the public management page', async () => {
  await seed({ ...failure(), models: failure().models.slice(0, 1) });
  await seed(failure('PUBLIC'));
  render(<Page scope="PUBLIC" card="manager" />);
  expect(screen.getByRole('status')).toHaveTextContent('Last check: 2 issue(s) in Public models');
  expect(screen.getByRole('status')).not.toHaveTextContent('3 issue(s)');
  expectNoProbe();
});

it('hides the notice and badge after the authoritative saved check reports repair', async () => {
  await seed();
  render(<Page />);
  fireEvent.click(screen.getByRole('button', { name: 'View check details for Broken model' }));
  await screen.findByRole('alert');
  reports.PERSONAL = { ...failure(), healthy: true, models: [], presented: true };
  await act(async () => {
    await checkModelHealth(user, { force: true, modelId: '42' });
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('Last check failed')).not.toBeInTheDocument();
});

it('updates the count after a debug failure using the returned Redis report without extra inference', async () => {
  await seed({ ...failure(), models: failure().models.slice(0, 1) });
  render(<Page />);
  const updated = failure();
  updated.models[1] = { ...updated.models[1], modelName: 'Second broken model', errorCode: 'DEBUG_FAILED' };
  (POST as jest.Mock)
    .mockResolvedValueOnce({ code: 0, data: 7 })
    .mockResolvedValueOnce({ code: 0, data: { ...updated, dismissed: true, presented: true } });
  await act(async () => {
    await expect(
      runModelDebugWithHealth(user, { modelId: '43', scope: 'PERSONAL' }, async () => {
        throw new Error('upstream failed');
      })
    ).rejects.toThrow();
  });
  expect(screen.getByRole('status')).toHaveTextContent('Last check: 2 issue(s)');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expectNoProbe();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('lets ordinary users inspect public diagnostics without repair controls', async () => {
  await seed(failure('PUBLIC'));
  render(<Page scope="PUBLIC" card="readonly" />);
  fireEvent.click(screen.getByRole('button', { name: 'View check details for Broken model' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Contact an administrator to fix the public model configuration.')).toBeInTheDocument();
  expect(screen.queryByText('Edit configuration')).not.toBeInTheDocument();
  expect(screen.queryByText('Check again')).not.toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('keeps manually opened personal diagnostics when an administrator login returns public results', async () => {
  const owner = { ...user, userCode: 'adminvip' };
  await seed(failure('PUBLIC'), owner);
  await seed(failure('PERSONAL'), owner);
  render(<Page owner={owner} />);
  fireEvent.click(screen.getByRole('button', { name: 'View check details for Broken model' }));
  await screen.findByRole('alert');
  await waitFor(() => expect((POST as jest.Mock).mock.calls.some(([url]) => url.endsWith('/healthCheck'))).toBe(true));
  expect(screen.getByRole('alert')).toHaveTextContent('Personal models');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Public models');
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('removes deleted warnings and updates an open notice using Redis without a probe', async () => {
  await seed();
  render(<Page />);
  fireEvent.click(screen.getByRole('button', { name: 'View check details for Broken model' }));
  await screen.findByRole('alert');
  await act(async () => {
    await removeCachedModelHealth('42');
  });
  await waitFor(() => expect(screen.queryByText('Last check failed')).not.toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveTextContent('Last check: 1 issue(s)');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expectNoProbe();
});
