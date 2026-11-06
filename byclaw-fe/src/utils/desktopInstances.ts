import type { ISandboxesInfo } from '@/models/common/useAppStore';

export type SandboxInstanceRef = { sandboxId: string; instance: string; mappingId?: string };
export const desktopKey = (ref: SandboxInstanceRef) =>
  JSON.stringify([ref.sandboxId, ref.mappingId ?? null, ref.instance]);
export function normalizeInstanceRefs(value: unknown): SandboxInstanceRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (ref) =>
        ref &&
        typeof ref.sandboxId === 'string' &&
        ref.sandboxId.trim() &&
        ref.sandboxId === ref.sandboxId.trim() &&
        typeof ref.instance === 'string' &&
        ref.instance.trim() &&
        ref.instance === ref.instance.trim() &&
        (ref.mappingId === undefined ||
          (typeof ref.mappingId === 'string' && ref.mappingId.trim() && ref.mappingId === ref.mappingId.trim()))
    )
    .map(({ sandboxId, instance, mappingId }) => ({
      sandboxId,
      instance,
      ...(mappingId === undefined ? {} : { mappingId }),
    }));
}
export function mergeInstanceRefs(current: unknown, incoming: unknown): SandboxInstanceRef[] {
  const seen = new Set<string>();
  return [...normalizeInstanceRefs(current), ...normalizeInstanceRefs(incoming)].filter((ref) => {
    const key = desktopKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function listDesktops(rows: ISandboxesInfo[]) {
  return rows.flatMap((row) =>
    Object.keys(row.instanceEndpoints || {}).flatMap((instance) => {
      const descriptor = row.instanceDescriptors?.[instance];
      if (descriptor ? descriptor.viewer !== 'novnc' : !['vnc', 'desktop'].includes(instance)) return [];
      if (row.isShared && !row.mappingId) return [];
      const ref: SandboxInstanceRef = {
        sandboxId: row.sandboxId,
        instance,
        ...(row.mappingId ? { mappingId: row.mappingId } : {}),
      };
      return [
        {
          ref,
          label: `${descriptor?.label || instance} · ${
            row.sandboxType ? `${row.sandboxType} (${row.sandboxId.slice(-8)})` : row.sandboxId
          }`,
          row,
        },
      ];
    })
  );
}
function isDesktopProxySegment(value: string) {
  return (
    value &&
    value.length <= 256 &&
    value === value.trim() &&
    value !== '.' &&
    value !== '..' &&
    // eslint-disable-next-line no-control-regex
    !/[\\/\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

function isDesktopProxyNavigation(url: URL, ref: SandboxInstanceRef, shared?: boolean) {
  const prefix = '/byaiService/sandbox/desktop/';
  if (url.origin !== window.location.origin || !url.pathname.startsWith(prefix)) return false;
  const segments = url.pathname.slice(prefix.length).split('/').map(decodeURIComponent);
  const entry = segments.pop()!;
  const identity = shared
    ? ['shared', ref.mappingId, ref.sandboxId, ref.instance]
    : ['exclusive', ref.sandboxId, ref.instance];
  return (
    segments.length === identity.length &&
    segments.every((value, index) => value === identity[index] && isDesktopProxySegment(value)) &&
    (!entry || (isDesktopProxySegment(entry) && !entry.includes('%') && /\.html$/i.test(entry)))
  );
}

export function resolveDesktop(rows: ISandboxesInfo[], ref: SandboxInstanceRef) {
  const target = listDesktops(rows).find((item) => desktopKey(item.ref) === desktopKey(ref));
  if (!target) return undefined;
  try {
    const url = new URL(target.row.instanceEndpoints![ref.instance], window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    // The authenticated same-origin proxy supplies provider headers for HTTP and WebSocket requests.
    if (
      target.row.endpointHeaders &&
      Object.keys(target.row.endpointHeaders).length &&
      !isDesktopProxyNavigation(url, ref, target.row.isShared)
    )
      return undefined;
    if (/\/proxy\/\d+$/.test(url.pathname)) url.pathname += '/';
    url.searchParams.set('autoconnect', 'true');
    url.searchParams.set('resize', 'scale');
    return { ...target, url: url.toString() };
  } catch {
    return undefined;
  }
}

/** Race a directory subscriber without cancelling another viewer's shared request. */
export async function withDesktopTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TIMEOUT')), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
export function isExplicitNonDesktop(rows: ISandboxesInfo[], ref: SandboxInstanceRef) {
  const row = rows.find(
    (item) => item.sandboxId === ref.sandboxId && (item.mappingId ?? null) === (ref.mappingId ?? null)
  );
  const descriptor = row?.instanceDescriptors?.[ref.instance];
  return descriptor
    ? descriptor.viewer !== 'novnc'
    : Boolean(row?.instanceEndpoints?.[ref.instance] && !['vnc', 'desktop'].includes(ref.instance));
}
export async function probeDesktop(url: string, timeout: number): Promise<'ready' | 'retry' | 'auth'> {
  if (new URL(url, window.location.origin).origin !== window.location.origin) return 'ready';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
    if (response.status === 401 || response.status === 403) return 'auth';
    return response.status >= 500 ? 'retry' : 'ready';
  } catch {
    return 'retry';
  } finally {
    clearTimeout(timer);
  }
}
