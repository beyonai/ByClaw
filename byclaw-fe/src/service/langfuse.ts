// Shared Langfuse service layer. Mirrors LangfuseController on the backend
// (com.iwhalecloud.byai.state.interfaces.controller.langfuse.LangfuseController).
// Lives in src/service/ so chat + manager + any future surface can import from one place.
import { GET, POST } from '@/service/common/request';

export interface LangfuseConfig {
  host?: string;
  projectId?: string;
  environment?: string;
  hasSecretKey?: boolean;
  hasPublicKey?: boolean;
  enabled?: boolean;
}

export const getLangfuseConfig = () => GET<LangfuseConfig>('/byaiService/langfuse/config');

export const getLangfuseFlow = ({ sessionId, ...params }: { sessionId: string; [k: string]: any }) =>
  POST<any>(`/byaiService/langfuse/sessions/${sessionId}/flow`, { ...params });

export const getTraceTimelineBasicInfo = ({ traceId, ...params }: { traceId: string; [k: string]: any }) =>
  POST<any>(`/byaiService/langfuse/getTraceTimelineBasicInfo/${traceId}`, { ...params });

export const getTraceById = (traceId: string) => GET<any>(`/byaiService/langfuse/traces/${traceId}`);

export const getObservationsByTraceId = (traceId: string, params: any = {}) =>
  POST<any>(`/byaiService/langfuse/traces/${traceId}/observations`, { ...params });

/**
 * Build a direct link to the Langfuse trace detail page. Returns null when host
 * or projectId is missing — callers should hide the "Open in Langfuse" entry
 * rather than render a broken link.
 */
export const buildLangfuseTraceUrl = (host?: string, projectId?: string, traceId?: string): string | null => {
  if (!host || !projectId || !traceId) return null;
  const normalizedHost = host.replace(/\/+$/, '');
  return `${normalizedHost}/project/${encodeURIComponent(projectId)}/traces/${encodeURIComponent(traceId)}`;
};

/**
 * Build a same-origin proxied Langfuse trace URL. The nginx `/langfuse` location
 * rewrites to `/byaiService/langfuse/**` and the BE `LangfuseProxyController` then
 * forwards to the internal Langfuse instance with Basic Auth injected. Langfuse
 * itself is built with `NEXT_PUBLIC_BASE_PATH=/langfuse` so every resource inside
 * the returned HTML stays under the same `/langfuse` prefix. Returns null when
 * projectId or traceId is missing.
 */
export const buildLangfuseProxyTraceUrl = (projectId?: string, traceId?: string): string | null => {
  if (!projectId || !traceId) return null;
  return `/langfuse/project/${encodeURIComponent(projectId)}/traces/${encodeURIComponent(traceId)}`;
};
