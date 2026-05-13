import { GET, POST } from '@/service/common/request';

type HttpOptions = {
  method?: string;
  body?: Record<string, unknown>;
};

/**
 * 运营台从旧项目迁移的接口封装：路径为 /system/...、/catalog/...、/new/... 等，统一走 /byaiService 网关。
 * 与旧代码 `byai_manager_fe` 中 `@/utils/http` 用法一致（method + body）。
 */
export default function http(path: string, options: HttpOptions = {}, responseCfg?) {
  const method = (options.method || 'POST').toUpperCase();
  const fullPath = path.startsWith('/byaiService') ? path : `/byaiService${path.startsWith('/') ? '' : '/'}${path}`;
  const payload = options.body ?? {};
  if (method === 'GET') {
    return GET(fullPath, payload, responseCfg);
  }
  return POST(fullPath, payload, responseCfg);
}
