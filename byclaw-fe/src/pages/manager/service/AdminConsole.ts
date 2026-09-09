import { POST } from '@/service/common/request';

const cfg = { responseCfg: { customHandle: true } };
export const runRedisCommand = (command: string) => POST('/byaiService/admin-console/redis/command', { command }, cfg);
