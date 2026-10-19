import { getIntl } from '@umijs/max';

export const CONNECTOR_AUTHORIZATION_REQUEST_EVENT = 'byclaw-open-connector-authorization';

const MEDIA_CONNECTOR_ACTIONS = {
  'image-generation-model': 'connector.configureImage',
  'speech-generation-model': 'connector.configureSpeech',
} as const;

export type MediaConnectorCode = keyof typeof MEDIA_CONNECTOR_ACTIONS;

export const parseConnectorAction = (output: string, intl?: ReturnType<typeof getIntl>) => {
  if (!output.includes('MEDIA_CONNECTOR_CONFIGURATION_REQUIRED')) return undefined;
  const connectorCode = /(?:^|\s)connectorCode=([a-z0-9-]+);/u.exec(output)?.[1] as MediaConnectorCode | undefined;
  // Resolve the label when the action is parsed so language changes do not freeze it at module load.
  const messageId = connectorCode ? MEDIA_CONNECTOR_ACTIONS[connectorCode] : undefined;
  const label = messageId ? (intl || getIntl()).formatMessage({ id: messageId }) : undefined;
  return connectorCode && label ? { connectorCode, label } : undefined;
};

type ConnectorActionItem = {
  content?: {
    substance?: unknown;
  };
};

const getToolOutput = (substance: unknown): string => {
  if (!substance || typeof substance !== 'object' || !('output' in substance)) return '';
  const output = (substance as { output?: unknown }).output;
  if (typeof output === 'string') return output;
  if (output === undefined || output === null) return '';
  try {
    return JSON.stringify(output);
  } catch {
    return `${output}`;
  }
};

export const collectConnectorActions = (items: ConnectorActionItem[] = [], intl?: ReturnType<typeof getIntl>) => {
  const actions = new Map<MediaConnectorCode, ReturnType<typeof parseConnectorAction>>();
  items.forEach((item) => {
    const action = parseConnectorAction(getToolOutput(item.content?.substance), intl);
    if (action && !actions.has(action.connectorCode)) actions.set(action.connectorCode, action);
  });
  return Array.from(actions.values()).filter((action): action is NonNullable<typeof action> => Boolean(action));
};

export const requestConnectorAuthorization = (connectorCode: MediaConnectorCode) => {
  window.dispatchEvent(
    new CustomEvent(CONNECTOR_AUTHORIZATION_REQUEST_EVENT, {
      detail: { connectorCode },
    })
  );
};
