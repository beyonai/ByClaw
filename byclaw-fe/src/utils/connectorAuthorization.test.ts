import {
  parseConnectorAction,
  requestConnectorAuthorization,
  CONNECTOR_AUTHORIZATION_REQUEST_EVENT,
} from './connectorAuthorization';

let mockLocale: 'zh-CN' | 'en-US' = 'zh-CN';
jest.mock('@umijs/max', () => ({ getIntl: () => require('@/testUtils/localeIntl').getLocaleIntl(mockLocale) }));

it('resolves action labels in the current locale and preserves connector protocol codes', () => {
  const output = 'MEDIA_CONNECTOR_CONFIGURATION_REQUIRED connectorCode=image-generation-model;';
  mockLocale = 'zh-CN';
  expect(parseConnectorAction(output)).toEqual({
    connectorCode: 'image-generation-model',
    label: '配置文生图模型连接器',
  });
  mockLocale = 'en-US';
  expect(parseConnectorAction(output)).toEqual({
    connectorCode: 'image-generation-model',
    label: 'Configure image generation model connector',
  });
  expect(parseConnectorAction('MEDIA_CONNECTOR_CONFIGURATION_REQUIRED connectorCode=speech-generation-model;')).toEqual(
    { connectorCode: 'speech-generation-model', label: 'Configure speech model connector' }
  );
  expect(parseConnectorAction('connectorCode=image-generation-model;')).toBeUndefined();
  expect(parseConnectorAction('MEDIA_CONNECTOR_CONFIGURATION_REQUIRED connectorCode=unknown;')).toBeUndefined();
  const received = jest.fn();
  window.addEventListener(CONNECTOR_AUTHORIZATION_REQUEST_EVENT, received);
  try {
    requestConnectorAuthorization('speech-generation-model');
    expect(received.mock.calls[0][0].detail).toEqual({ connectorCode: 'speech-generation-model' });
  } finally {
    window.removeEventListener(CONNECTOR_AUTHORIZATION_REQUEST_EVENT, received);
  }
});
