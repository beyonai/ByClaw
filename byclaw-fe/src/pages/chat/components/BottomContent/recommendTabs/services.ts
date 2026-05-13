import { POST } from '@/service/common/request';

export function getTemplateList(params: any) {
  return POST('/byaiService/api/v1/template-sessions/page', params);
}

export function getTemplateDetail(params: any) {
  return POST('/byaiService/api/v1/template-sessions/getTemplateSessionDetail', params);
}

export function deleteTemplate(params: any) {
  return POST('/byaiService/api/v1/template-sessions/deleteTemplateSession', params);
}
