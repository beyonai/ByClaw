export const CONNECTOR_AUTHORIZATION_REQUEST_EVENT = 'byclaw-open-connector-authorization';

const MEDIA_CONNECTOR_ACTIONS = {
  'image-generation-model': '配置文生图模型连接器',
  'speech-generation-model': '配置语音模型连接器',
} as const;

export type MediaConnectorCode = keyof typeof MEDIA_CONNECTOR_ACTIONS;

export const parseConnectorAction = (output: string) => {
  if (!output.includes('MEDIA_CONNECTOR_CONFIGURATION_REQUIRED')) return undefined;
  const connectorCode = /(?:^|\s)connectorCode=([a-z0-9-]+);/u.exec(output)?.[1] as MediaConnectorCode | undefined;
  const label = connectorCode ? MEDIA_CONNECTOR_ACTIONS[connectorCode] : undefined;
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

export const collectConnectorActions = (items: ConnectorActionItem[] = []) => {
  const actions = new Map<MediaConnectorCode, ReturnType<typeof parseConnectorAction>>();
  items.forEach((item) => {
    const action = parseConnectorAction(getToolOutput(item.content?.substance));
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
