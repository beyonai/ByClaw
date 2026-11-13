import { GET, POST } from '@/service/common/request';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlatformTenantHarnessLaunch from '../PlatformTenantHarnessLaunch';

const mockDispatch = jest.fn();

jest.mock('@umijs/max', () => ({
  useDispatch: () => mockDispatch,
  useIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl('en-US'),
}));
jest.mock('@/service/common/request', () => ({ GET: jest.fn(), POST: jest.fn() }));

const endpoint = '/byaiService/admin/tenants/1/harness';
const get = GET as jest.Mock;
const post = POST as jest.Mock;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  mockDispatch.mockReset();
  mockDispatch.mockImplementation(({ success }) => success([{ serviceType: 'tenant-harness', profileKey: 's' }]));
});

afterEach(() => {
  jest.useRealTimers();
});

it('requests startup with the selected profile and waits for Worker readiness', async () => {
  jest.useFakeTimers();
  const refreshResources = jest.fn();
  get
    .mockResolvedValueOnce({ status: 'NOT_REQUESTED', workerReady: false })
    .mockResolvedValueOnce({ status: 'SUCCEEDED', workerReady: true });
  post.mockResolvedValueOnce({ status: 'PENDING', workerReady: false });
  render(<PlatformTenantHarnessLaunch onResourcesChanged={refreshResources} />);

  fireEvent.click(screen.getByRole('button', { name: 'Start platform tenant Harness' }));
  await screen.findByText('Startup has not been requested for the platform tenant Harness');
  expect(mockDispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'sandboxMgr/listServiceProfiles',
      payload: { serviceType: 'tenant-harness', enabledOnly: true },
    })
  );
  const profile = screen.getByRole('combobox');
  fireEvent.mouseDown(profile);
  fireEvent.keyDown(profile, { key: 'Enter', keyCode: 13 });
  fireEvent.click(screen.getByRole('button', { name: 'Request startup' }));
  await screen.findByText('Startup requested and queued');
  expect(post).toHaveBeenCalledWith(`${endpoint}/ensure`, { profileKey: 's' }, expect.anything());
  expect(screen.getByRole('button', { name: 'Request startup' })).toBeDisabled();

  await act(async () => {
    jest.advanceTimersByTime(2500);
  });
  await screen.findByText('The Harness Worker is ready');
  expect(get).toHaveBeenLastCalledWith(endpoint, {}, expect.anything());
  expect(refreshResources).toHaveBeenCalledTimes(2);
});

it('rechecks an uncertain launch using its frozen profile', async () => {
  get.mockResolvedValueOnce({
    status: 'MANUAL_REQUIRED',
    profileKey: 'm',
    workerReady: false,
    errorCode: 'PROVIDER_RESULT_UNKNOWN',
  });
  post.mockResolvedValueOnce({ status: 'PENDING', workerReady: false });
  render(<PlatformTenantHarnessLaunch onResourcesChanged={jest.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Start platform tenant Harness' }));
  await screen.findByText('PROVIDER_RESULT_UNKNOWN');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Recheck instance' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith(`${endpoint}/ensure`, { profileKey: 'm' }, expect.anything()));
});
