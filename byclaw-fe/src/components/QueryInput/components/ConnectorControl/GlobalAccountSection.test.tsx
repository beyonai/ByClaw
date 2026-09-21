const mockOperationAccountPanel = jest.fn((props: { allowAccountCreation?: boolean }) => (
  <div data-testid="operation-account-panel">{String(props.allowAccountCreation)}</div>
));
const mockUseOperationAccountLogin = jest.fn();
const mockListGlobalOperationAccounts = jest.fn();

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfig: jest.fn(),
}));
jest.mock('@/layout/sider/components/ProjectSpaceList/operation', () => ({
  buildGlobalOperationAccountPayload: jest.fn(),
  normalizeOperationAccounts: (accounts: unknown) => accounts,
  OperationAccountPanel: mockOperationAccountPanel,
  useOperationAccountLogin: mockUseOperationAccountLogin,
}));
jest.mock('@/service/devloop', () => ({
  createGlobalOperationAccount: jest.fn(),
  deleteOperationAccount: jest.fn(),
  listGlobalOperationAccounts: mockListGlobalOperationAccounts,
  updateOperationAccount: jest.fn(),
}));

import { render, screen, waitFor } from '@testing-library/react';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import GlobalAccountSection from './GlobalAccountSection';

const mockGetDcSystemConfig = getDcSystemConfig as jest.MockedFunction<typeof getDcSystemConfig>;

describe('GlobalAccountSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListGlobalOperationAccounts.mockResolvedValue([]);
    mockUseOperationAccountLogin.mockReturnValue({
      loginTarget: null,
      loginPreparingAccountId: null,
      loginConfirming: false,
      handleLogin: jest.fn(),
      handleConfirmLogin: jest.fn(),
      closeRemoteDesktop: jest.fn(),
    });
  });

  it('hides account creation for the commercial brand', async () => {
    mockGetDcSystemConfig.mockResolvedValue({ data: { paramValue: 'commercial' } });

    render(<GlobalAccountSection />);

    await waitFor(() => expect(screen.getByTestId('operation-account-panel')).toHaveTextContent('false'));
    expect(mockGetDcSystemConfig).toHaveBeenCalledWith({ paramCode: 'BYAI_BRAND_VERSION' });
  });

  it('keeps account creation available for non-commercial brands', async () => {
    mockGetDcSystemConfig.mockResolvedValue({ paramValue: 'openSource' });

    render(<GlobalAccountSection />);

    await waitFor(() => expect(screen.getByTestId('operation-account-panel')).toHaveTextContent('true'));
  });
});
