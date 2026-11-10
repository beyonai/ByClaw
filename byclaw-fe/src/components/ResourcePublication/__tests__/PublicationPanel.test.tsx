import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { currentPublication, publicationAction } from '@/service/resourcePublication';
import PublicationPanel from '../PublicationPanel';
import ScopeSelector from '../ScopeSelector';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: any) => id }),
  getIntl: () => ({ formatMessage: ({ id }: any) => id }),
}));
jest.mock('@/service/resourcePublication', () => ({
  ...jest.requireActual('@/service/resourcePublication'),
  scopeOptions: jest.fn().mockResolvedValue([{ orgId: '101', orgName: 'Research', parentOrgId: '-1' }]),
  currentPublication: jest.fn(),
  publicationDetail: jest.fn(),
  publicationAction: jest.fn(),
}));
jest.mock('@/service/common/request', () => ({ GET: jest.fn(), POST: jest.fn() }));

const detail = {
  publication: {
    requestId: '9007199254740999',
    resourceId: '7',
    revision: 3,
    status: 'PENDING',
    reviewSnapshotJson: '{"resourceName":"Knowledge"}',
    requestedScopeJson: '[101,202]',
  },
  scopeMode: 'COMPANY',
  scopeRevision: 4,
  scopeController: 'SYNC',
  publishedScope: [{ orgId: '-1', orgName: 'Company' }],
  canManage: false,
  canSubmit: false,
  canWithdraw: false,
  canReview: true,
  targets: [
    { canReview: true, target: { orgId: '101', orgNameSnapshot: 'Research', status: 'PENDING' } },
    { canReview: false, target: { orgId: '202', orgNameSnapshot: 'Finance', status: 'APPROVED' } },
  ],
};
beforeEach(() => {
  jest.clearAllMocks();
  (currentPublication as jest.Mock).mockResolvedValue(detail);
  (publicationAction as jest.Mock).mockResolvedValue({ ...detail, canReview: false, targets: [] });
});
it('reviews only selectable organizations with the server revision and keeps large IDs as strings', async () => {
  render(<PublicationPanel resourceId="7" />);
  await screen.findByText('Research');
  expect(screen.queryByText('rp.prepare')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('rp.approve'));
  await waitFor(() =>
    expect(publicationAction).toHaveBeenCalledWith(
      'review',
      expect.objectContaining({
        requestId: '9007199254740999',
        revision: 3,
        targetOrgIds: ['101'],
        approved: true,
      })
    )
  );
});
it('renders approved replacement targets as waiting while the existing company scope remains effective', async () => {
  render(<PublicationPanel resourceId="7" />);
  await screen.findByText(/rp.waitingReplacement/);
  expect(screen.getByText('rp.company')).toBeInTheDocument();
  expect(screen.queryByText('rp.retract')).not.toBeInTheDocument();
});
it('has no mutation during read and requires scope selection before submitting a draft', async () => {
  (currentPublication as jest.Mock).mockResolvedValue({
    ...detail,
    publication: undefined,
    targets: [],
    publishedScope: [],
    scopeMode: 'NONE',
    canManage: true,
    canReview: false,
  });
  render(<PublicationPanel resourceId="7" />);
  await screen.findByText('rp.prepare');
  expect(publicationAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('rp.organizations'));
  expect(screen.getByText('rp.prepare').closest('button')).toBeDisabled();
});
it('switching company to organizations clears the former scope rather than silently retaining company', () => {
  const change = jest.fn();
  render(<ScopeSelector value={{ mode: 'COMPANY' }} onChange={change} />);
  fireEvent.click(screen.getByLabelText('rp.organizations'));
  expect(change).toHaveBeenCalledWith({ mode: 'ORGS', orgIds: [] });
});

it('can replace a deleted organization scope even when no current labels remain', async () => {
  (currentPublication as jest.Mock).mockResolvedValue({
    ...detail,
    publication: undefined,
    targets: [],
    publishedScope: [],
    scopeMode: 'ORGS',
    canManage: true,
    canReview: false,
  });
  render(<PublicationPanel resourceId="7" />);
  fireEvent.click(await screen.findByText('rp.prepare'));
  await waitFor(() =>
    expect(publicationAction).toHaveBeenCalledWith(
      'prepare',
      expect.objectContaining({
        operation: 'REPLACE_SCOPE',
        publishScope: { mode: 'COMPANY' },
      })
    )
  );
});
