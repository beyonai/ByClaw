/* eslint-disable indent */
import { get } from 'lodash';
import { SSEMessageType } from '@/constants/message';
import { IAgentCache } from '@/typescript/agent';
import { getOpenClawWebSocket, OpenClawWebSocketClient } from '@/utils/openClaw/openclawWebSocket';
import { generateFilePrompt } from '@/utils/openClaw/utils';
import { ISession } from '@/typescript/session';
import { POST } from '@/service/common/request';

// OpenClaw WebSocket 版 SendHelper，仅在 agentType=openclaw 时使用
// 签名尽量与通用 SendHelper 保持一致，方便复用 useSend / useChat 逻辑

export type OpenclawSendParams = {
  callback?: (formatMessage: any, msg: { data: string; event: string; id: string }) => void;
} & { [key: string]: unknown };

const REQ_TIMEOUT = 1200000; // 二十分钟，与通用 SendHelper 保持一致

export default class OpenclawSendHelper {
  wsUrl: string;

  token: string;

  updateSessionRef: React.RefObject<(session: Partial<ISession>) => void>;

  constructor(props: { agentInfo: IAgentCache; updateSession: React.RefObject<(session: Partial<ISession>) => void> }) {
    const { agentInfo, updateSession } = props;
    const { agentHomeUrl } = agentInfo;
    this.updateSessionRef = updateSession;
    const url = new URL(agentHomeUrl!);
    this.token = url.searchParams.get('token') || '';
    this.wsUrl = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.hostname}:${url.port}`;
  }

  updateSession(session: Partial<ISession>) {
    this.updateSessionRef.current?.(session);
    const client = getOpenClawWebSocket();
    if (!client) return;
    POST('/byaiService/open/api/v1/updateSession', {
      sessionId: client.getRealSessionId(),
      sessionContent: session.sessionContent,
    });
  }

  send(
    data: any,
    params: OpenclawSendParams,
    // 与通用 SendHelper 保持第三个参数形态，但这里不会使用 fetch 相关配置
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _fetchOpt: {
      useEventSource?: boolean;
    } = {}
  ) {
    const { callback } = params;
    const content = data?.chatContent ?? '';
    const sessionId = data?.sessionId ?? '';

    let finished = false;
    let timer: NodeJS.Timeout | undefined;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const client = getOpenClawWebSocket();
      if (!client) {
        reject(new Error('OpenClaw WebSocket not connected'));
        return;
      }

      client
        .ensureConnected()
        .then(() => {
          // 如果携带了文件信息，则使用 generateFilePrompt 将文件上下文编码进提示词中
          let finalContent = String(content || '');
          try {
            const firstFile = get(data, 'files.0');
            if (firstFile && finalContent) {
              const fileInfo = {
                fileName: firstFile.fileName || firstFile.name,
                filePath: firstFile.fileUrl || firstFile.path,
                fileSize: firstFile.fileSize || firstFile.size,
              };
              if (fileInfo.fileName && fileInfo.filePath) {
                finalContent = generateFilePrompt(finalContent, fileInfo);
              }
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[OpenClaw] build file prompt failed:', e);
          }

          const { promise: wsPromise, cancel } = client.sendChat(finalContent, {
            onChunk: (chatPayload, phase) => {
              if (phase === 'delta' && !chatPayload.data?.delta) {
                return;
              }
              const { sseRes, sseMsg } = OpenClawWebSocketClient.toSsePayloadFromChat(chatPayload, phase);

              if (callback) {
                callback(sseRes, sseMsg);
              }

              if (phase === 'final') {
                if (!finished) {
                  finished = true;
                  clearTimer();
                  resolve({});
                }
              }

              if (phase === 'error') {
                if (!finished) {
                  finished = true;
                  clearTimer();
                  reject(new Error(SSEMessageType[SSEMessageType.error] || 'openclaw ws error'));
                }
              }
            },
            timeoutMs: REQ_TIMEOUT,
          });

          timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            cancel();
            reject(new Error('_TIMEOUT_'));
          }, REQ_TIMEOUT);

          wsPromise
            .then(() => {
              if (!finished) {
                finished = true;
                clearTimer();
                resolve({});
              }
            })
            .catch((e) => {
              if (!finished) {
                finished = true;
                clearTimer();
                reject(e);
              }
            });
        })
        .catch((e) => {
          if (!finished) {
            finished = true;
            clearTimer();
            reject(e);
          }
        })
        .finally(() => {
          this.updateSession({
            sessionId,
            // 先这样吧，后续再处理
            sessionContent: '',
            updateTime: Date.now().toString(),
          });
        });
    });

    const cancel = () => {
      if (finished) return;
      finished = true;
      clearTimer();
      // OpenClawWebSocketClient 自身不暴露 cancel 当前流的接口，这里仅停止本地后续处理
    };

    return {
      promise,
      cancel,
    };
  }
}
