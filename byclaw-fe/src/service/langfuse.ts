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

export const buildLangfuseTraceUrl = (host?: string, projectId?: string, traceId?: string): string | null => {
  if (!host || !projectId || !traceId) return null;
  const normalizedHost = host.replace(/\/+$/, '');
  return `${normalizedHost}/project/${encodeURIComponent(projectId)}/traces/${encodeURIComponent(traceId)}`;
};

export const buildLangfuseProxyTraceUrl = (projectId?: string, traceId?: string): string | null => {
  if (!projectId || !traceId) return null;
  return `/langfuse/project/${encodeURIComponent(projectId)}/traces/${encodeURIComponent(traceId)}`;
};
