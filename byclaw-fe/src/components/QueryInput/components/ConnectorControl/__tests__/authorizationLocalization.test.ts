import { getConnectorAuthorizationTerminalError, getCredentialAuthorizationError, type Connector } from '..';

let mockLocale = 'zh-CN';
jest.mock('@umijs/max', () => ({
  getIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/service/connector', () => ({}));
jest.mock('../GlobalAccountSection', () => () => null);

it('resolves authorization errors in the current language and preserves provider details', () => {
  const connector = { code: 'weixin-official-api', name: '业务公众号' } as Connector;
  mockLocale = 'zh-CN';
  expect(getConnectorAuthorizationTerminalError({ status: 'expired' })).toBe('授权任务已失效，请重新发起连接');
  expect(getCredentialAuthorizationError(connector, 'CONNECTOR_CREDENTIAL_INVALID')).toBe(
    'AppID 或 AppSecret 无效，请检查后重试'
  );
  mockLocale = 'en-US';
  expect(getConnectorAuthorizationTerminalError({ status: 'expired' })).toBe(
    'Authorization expired. Please reconnect.'
  );
  expect(getCredentialAuthorizationError(connector, 'CONNECTOR_CREDENTIAL_INVALID')).toBe(
    'Invalid AppID or AppSecret. Check and try again.'
  );
  expect(getConnectorAuthorizationTerminalError({ status: 'failed', errorMessage: 'Provider detail 123' })).toBe(
    'Provider detail 123'
  );
  expect(getConnectorAuthorizationTerminalError({ status: 'connected' })).toBeUndefined();
  expect(connector.name).toBe('业务公众号');
});
