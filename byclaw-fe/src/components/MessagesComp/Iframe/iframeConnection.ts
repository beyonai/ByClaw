export type IframeConnectionSnapshot = {
  state: 'connecting' | 'connected' | 'disconnected' | 'unknown';
  clean?: boolean;
  channelId?: string;
  attemptId?: number;
};

export type ConnectionMessage = {
  type: 'connection-observation-reset' | 'connection-state-change';
  data: {
    version: 1;
    channelId: string;
    attemptId: number;
    state?: 'connected' | 'disconnected';
    clean?: boolean;
  };
};

export function iframeOrigins(url: string, extra: string[] = []): string[] {
  const origins = new Set<string>();
  try {
    const parsed = new URL(url, window.location.href);
    const origin = parsed.protocol === 'about:' ? window.location.origin : parsed.origin;
    if (origin !== 'null') origins.add(origin);
  } catch {
    // Invalid/opaque URLs must not create a wildcard trust rule.
  }
  extra.forEach((value) => {
    try {
      const parsed = new URL(value);
      if (parsed.origin === value && /^https?:$/.test(parsed.protocol)) origins.add(value);
    } catch {
      // Ignore invalid configured origins.
    }
  });
  return [...origins];
}

export function isConnectionMessage(value: any): value is ConnectionMessage {
  const data = value?.data;
  return Boolean(
    data &&
      data.version === 1 &&
      typeof data.channelId === 'string' &&
      Number.isSafeInteger(data.attemptId) &&
      data.attemptId >= 0 &&
      (value.type === 'connection-observation-reset' ||
        (value.type === 'connection-state-change' &&
          (data.state === 'connected' || data.state === 'disconnected') &&
          (data.clean === undefined || typeof data.clean === 'boolean')))
  );
}
