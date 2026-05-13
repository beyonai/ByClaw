import { useCallback, useRef } from 'react';
import { POST } from '@/service/common/request';

type RequestFunction = (
  ...args: Parameters<typeof POST> extends [string, ...infer Rest] ? Rest : never
) => ReturnType<typeof POST>;

/**
 * @description 重复调用函数时，可以取消上一次的请求
 *
 * 传入的函数必须是重新包装过的api函数，接收参数必须要用spread operator，例如：
 * async function api(...params) {
 *   return POST('你的url', ...params)
 * }
 * 只有这种形式的函数，才能接收这里的AbortController作为额外的参数
 *
 * 并且，最好自己再catch一下，不然会存在unhandledrejection，例如
 * const myApi = useAbortRequest(api);
 * myApi(data).catch(() => {})
 *
 * @param request RequestFunction
 * @returns Promise
 */

export default function useAbortRequest(request: RequestFunction) {
  const controllerRef = useRef<AbortController | null>(null);

  return useCallback(
    async (...params: Parameters<RequestFunction>) => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
      controllerRef.current = new AbortController();
      const [data, config, ...rest] = params;
      const myConfig = {
        ...(config || {}),
        cancelToken: controllerRef.current,
      };
      return request(data, myConfig, ...rest).then(
        (res) => {
          controllerRef.current = null;
          return res;
        },
        (err) => {
          if (err && err.name === 'CanceledError') {

            /**
             * 这种属于请求被取消了，不要重置controllerRef.current。如果重置，会存在以下问题：
             * 先后发出了A，B请求，B发出后，A请求被取消了，此时触发CanceledError
             * 如果这个时候重置，那么再发出一个C请求后，因为controllerRef.current=null，所以B请求不会取消
             */
            return Promise.reject();
          }
          controllerRef.current = null;
          return Promise.reject(err);
        }
      );
    },
    [request]
  );
}
