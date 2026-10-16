export const CONNECTOR_AUTHORIZATION_REQUEST_EVENT = 'byclaw-open-connector-authorization';

const MEDIA_CONNECTOR_ACTIONS = {
  'image-generation-model': '配置文生图模型',
  'speech-generation-model': '配置语音模型',
} as const;

export type MediaConnectorCode = keyof typeof MEDIA_CONNECTOR_ACTIONS;

export const parseConnectorAction = (output: string) => {
  if (!output.includes('MEDIA_CONNECTOR_CONFIGURATION_REQUIRED')) return undefined;
  const connectorCode = /(?:^|\s)connectorCode=([a-z0-9-]+);/u.exec(output)?.[1] as MediaConnectorCode | undefined;
  const label = connectorCode ? MEDIA_CONNECTOR_ACTIONS[connectorCode] : undefined;
  return connectorCode && label ? { connectorCode, label } : undefined;
};

export const requestConnectorAuthorization = (connectorCode: MediaConnectorCode) => {
  window.dispatchEvent(
    new CustomEvent(CONNECTOR_AUTHORIZATION_REQUEST_EVENT, {
      detail: { connectorCode },
    })
  );
};
