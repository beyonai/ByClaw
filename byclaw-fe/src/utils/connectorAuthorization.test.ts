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

it('recognizes digital human configuration errors and opens the matching connector', () => {
  mockLocale = 'zh-CN';
  const output = 'MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=volcengine-digital-human;';
  expect(parseConnectorAction(output)).toEqual({
    connectorCode: 'volcengine-digital-human',
    label: '需要配置火山数字人视频连接器',
  });
  mockLocale = 'en-US';
  expect(parseConnectorAction(output)?.label).toBe('Configure Volcengine digital human video connector');
  const received = jest.fn();
  window.addEventListener(CONNECTOR_AUTHORIZATION_REQUEST_EVENT, received);
  try {
    requestConnectorAuthorization('volcengine-digital-human');
    expect(received.mock.calls[0][0].detail).toEqual({ connectorCode: 'volcengine-digital-human' });
  } finally {
    window.removeEventListener(CONNECTOR_AUTHORIZATION_REQUEST_EVENT, received);
  }
});
