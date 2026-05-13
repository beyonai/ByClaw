import { GET } from '@/service/common/request';

export const logged = (payload: any) => {
  return GET<any>('/api/bote/logged', { ...payload });
};
