// @ts-nocheck
import { POST } from '@/service/common/request';

export const getLangfuseFlow = ({ sessionId, ...params }: any) => {
  return POST(`/byaiService/langfuse/sessions/${sessionId}/flow`, { ...params });
};

export const getTraceTimelineBasicInfo = ({ traceId, ...params }: any) => {
  return POST(`/byaiService/langfuse/getTraceTimelineBasicInfo/${traceId}`, { ...params });
};
