export interface SandboxEndpoint {
  key: string;
  value: string;
  href?: string;
}

export const browserEndpoint = (value: string): string | undefined => {
  // Only browser URLs or same-origin paths may become links; never execute persisted scripts.
  if (!/^https?:\/\//i.test(value) && !(value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')))
    return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
};

export const sandboxEndpoints = (value?: string | null, sandboxType?: string): SandboxEndpoint[] => {
  if (!value?.trim()) return [];
  const raw = value.trim();
  let entries: [string, string][];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  } catch {
    // A malformed JSON document must not become a path/link.
    if (/^[{[]/.test(raw)) return [];
    entries = [[sandboxType || 'endpoint', raw]];
  }
  return entries.map(([key, address]) => {
    const text = address.trim();
    let href = browserEndpoint(text);
    // Only the OpenClaw chat UI needs its same-origin gateway override, never VNC/byCLI links.
    if (href && sandboxType === 'openclaw' && (key === 'openclaw' || entries.length === 1)) {
      const url = new URL(href, window.location.origin);
      const prefix = url.pathname.replace(/\/chat$/, '');
      url.searchParams.set('gatewayUrl', `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}${prefix}`);
      href = url.toString();
    }
    return { key, value: text, href };
  });
};

export const primarySandboxEndpoint = (value?: string | null, sandboxType?: string) => {
  const entries = sandboxEndpoints(value, sandboxType);
  return (
    entries.find((entry) => entry.key === 'openclaw' && entry.href)?.href || entries.find((entry) => entry.href)?.href
  );
};
