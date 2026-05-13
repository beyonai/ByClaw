import { POST } from '@/service/common/request';

export const queryKnowledgeBaseByUser = (payload: any) =>
  POST<any>('/knowledgeService/callDomainService/queryKnowledgeBaseByUser', {
    ...payload,
  });

export const queryAllIndicator = (payload: any) =>
  POST<any>('/knowledgeService/callDomainModel/queryAllIndicator', {
    ...payload,
  });

export const queryKnowledge = (payload: any, cancelToken?: AbortController) =>
  POST<any>(
    '/knowledgeService/callDomainModel/queryKnowledge',
    {
      ...payload,
    },
    { cancelToken }
  );

export const querySearchSuggestions = (payload: any) =>
  POST<any>('/knowledgeService/callDomainModel/querySearchSuggestions', {
    ...payload,
  });

export function getChatSystemConfig(payload: any) {
  return POST<any>('/knowledgeService/callDomainModel/getChatSystemConfig', {
    ...payload,
  });
}

export function queryKnowledgeBaseView(payload: any, cancelToken?: AbortController) {
  return POST<any>(
    'knowledgeService/callDomainModel/queryKnowledgeBaseView',
    {
      ...payload,
    },
    { cancelToken }
  );
}

export function queryKnowledgeBaseViewMeta(payload: any, cancelToken?: AbortController) {
  return POST<any>(
    'knowledgeService/callDomainModel/queryKnowledgeBaseViewMeta',
    {
      ...payload,
    },
    { cancelToken }
  );
}
