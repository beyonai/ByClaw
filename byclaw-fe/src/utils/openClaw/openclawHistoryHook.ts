import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { getOpenClawWebSocket } from './openclawWebSocket';
import { convertOpenClawToIMessage } from './openclawMessage';
import type { IMessage } from '@/typescript/message';

type ConversationHistoryResponse = {
  code: number | string;
  msg: string;
  data: {
    list: IMessage[];
    pageNum: number;
    pageSize: number;
    total: number;
  };
};

export function setupOpenClawHistoryHook(instance: AxiosInstance): void {
  // 不支持 Service Worker，则退回到 axios request 拦截器方案
  instance.interceptors.request.use(
    (config) => {
      const client = getOpenClawWebSocket();
      if (!client) {
        return config;
      }

      const originalAdapter = (config as any).adapter as
        | ((adapterConfig: InternalAxiosRequestConfig) => Promise<AxiosResponse<ConversationHistoryResponse>>)
        | undefined;

      const adapter = async (
        adapterConfig: InternalAxiosRequestConfig
      ): Promise<AxiosResponse<ConversationHistoryResponse>> => {
        try {
          await client.ensureConnected();

          const rawData = (adapterConfig.data || adapterConfig.params || {}) as {
            pageNum?: number;
            pageSize?: number;
          };

          const limit = 200;

          const history = await client.loadHistory(undefined, limit);
          const sessionKey = history.sessionKey || '';
          const messages = convertOpenClawToIMessage(history.messages, sessionKey, client.agentId);

          const pageNum = rawData?.pageNum ?? 1;
          const pageSize = messages.length;

          const data: ConversationHistoryResponse = {
            code: 0,
            msg: '',
            data: {
              list: messages,
              pageNum,
              pageSize,
              total: messages.length,
            },
          };

          const axiosResponse: AxiosResponse<ConversationHistoryResponse> = {
            data,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: adapterConfig,
            request: null as any,
          };

          return axiosResponse;
        } catch (error) {
          if (typeof originalAdapter === 'function') {
            return originalAdapter(adapterConfig);
          }
          return Promise.reject(error);
        }
      };

      // eslint-disable-next-line no-param-reassign
      (config as any).adapter = adapter;
      return config;
    },
    (error) => Promise.reject(error)
  );
}
