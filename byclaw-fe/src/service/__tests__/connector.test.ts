import {
  queryAllConnectors,
  queryConnectorList,
  revokeConnectorAuthorization,
  startConnectorAuthorization,
  startConnectorCredentialAuthorization,
  type StartConnectorAuthorizationPayload,
} from '../connector';

jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('connector service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the connector catalog with pagination from the list endpoint', () => {
    const query = { pageNum: 1, pageSize: 100, keyword: '' };
    queryConnectorList(query);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/connector/listAll', query);
  });

  it('revokes a connector authorization through the dedicated endpoint', () => {
    revokeConnectorAuthorization(9);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/connector/authorization/revoke', { connectorId: 9 });
  });

  it('sends IMA credentials only in the start authorization request body', () => {
    startConnectorCredentialAuthorization({
      connectorId: 9,
      redirectUrl: 'https://byclaw.example',
      credentials: { clientId: 'client-id', apiKey: 'api-key' },
    });

    expect(mockPOST).toHaveBeenCalledWith(
      '/byaiService/connector/authorization/start',
      {
        connectorId: 9,
        redirectUrl: 'https://byclaw.example',
        credentials: { clientId: 'client-id', apiKey: 'api-key' },
      },
      { responseCfg: { hideErrorTips: true } }
    );
  });

  it('keeps legacy authorization requests free of credentials and request overrides', () => {
    startConnectorAuthorization({ connectorId: 9, redirectUrl: 'https://byclaw.example' });

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/connector/authorization/start', {
      connectorId: 9,
      redirectUrl: 'https://byclaw.example',
    });
  });

  it('passes the credential verification abort controller to the request layer', () => {
    const cancelToken = new AbortController();

    startConnectorCredentialAuthorization({
      connectorId: 9,
      redirectUrl: 'https://byclaw.example',
      credentials: { clientId: 'client-id', apiKey: 'api-key' },
      cancelToken,
    });

    expect(mockPOST).toHaveBeenCalledWith(
      '/byaiService/connector/authorization/start',
      {
        connectorId: 9,
        redirectUrl: 'https://byclaw.example',
        credentials: { clientId: 'client-id', apiKey: 'api-key' },
      },
      { cancelToken, responseCfg: { hideErrorTips: true } }
    );
  });

  it('does not allow credentials in the legacy authorization payload type', () => {
    const payload: StartConnectorAuthorizationPayload = {
      connectorId: 9,
      redirectUrl: 'https://byclaw.example',
    };

    expect(payload).toEqual({ connectorId: 9, redirectUrl: 'https://byclaw.example' });
    if (false) {
      // @ts-expect-error Credentials must use startConnectorCredentialAuthorization.
      startConnectorAuthorization({ ...payload, credentials: { clientId: 'client-id', apiKey: 'api-key' } });
    }
  });

  it('loads every connector page and removes duplicate connector ids', async () => {
    mockPOST
      .mockResolvedValueOnce({
        list: [
          {
            connectorCode: 'dingtalk',
            connectorId: 1,
            connectorName: '钉钉',
            connectorType: 'SYSTEM',
            description: '',
            enableFlag: 'Y',
          },
        ],
        pageNum: 1,
        pageSize: 100,
        total: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        list: [
          {
            connectorCode: 'dingtalk',
            connectorId: 1,
            connectorName: '钉钉',
            connectorType: 'SYSTEM',
            description: '',
            enableFlag: 'Y',
          },
          {
            connectorCode: 'wecom',
            connectorId: 2,
            connectorName: '企业微信',
            connectorType: 'SYSTEM',
            description: '',
            enableFlag: 'N',
          },
        ],
        pageNum: 2,
        pageSize: 100,
        total: 2,
        totalPages: 2,
      });

    await expect(queryAllConnectors()).resolves.toEqual([
      expect.objectContaining({ connectorId: 1 }),
      expect.objectContaining({ connectorId: 2 }),
    ]);
    expect(mockPOST).toHaveBeenNthCalledWith(1, '/byaiService/connector/listAll', {
      pageNum: 1,
      pageSize: 100,
      keyword: '',
    });
    expect(mockPOST).toHaveBeenNthCalledWith(2, '/byaiService/connector/listAll', {
      pageNum: 2,
      pageSize: 100,
      keyword: '',
    });
  });
});
