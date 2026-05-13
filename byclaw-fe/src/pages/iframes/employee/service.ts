import { POST } from '@/service/common/request';
import { IAgent } from '@/typescript/agent';

export const qryEmployeeDetail = (agentId: string) => {
  return POST<{
    data: IAgent & {
      resourceId: string;
      resourceName: string;
    };
  }>('/byaiService/digitalEmployeeController/findDetailsById', {
    resourceId: agentId,
  });
};
