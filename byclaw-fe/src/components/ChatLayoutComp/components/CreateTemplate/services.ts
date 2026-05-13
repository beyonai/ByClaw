import { POST } from '@/service/common/request';

export function getTemplateDetail(params: any) {
  return POST('/byaiService/api/v1/template-sessions/getTemplateSessionDetail', params);
}

export function saveTemplate(params: any) {
  return POST('/byaiService/api/v1/template-sessions/saveOrUpdateTemplate', params, {
    headers: {
      'Content-Type': 'multipart/form-data; charset=utf-8',
    },
  });
}
