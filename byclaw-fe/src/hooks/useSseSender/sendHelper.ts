import { SSEEventStatus, SSEMessageType } from '@/constants/message';
import { getssoToken, getToken, ssotokenKey, tokenKey } from '@/utils/auth';
import { fetchEventSource } from '@fortaine/fetch-event-source';
import { getLocale } from '@umijs/max';
import { get, isEmpty, pick, set } from 'lodash';

import { globalLogout } from '@/service/common/request';
import { generateSignature } from '@/utils/signature';
import { answerDeltaHandler, reasoningLogHandler } from './util';
import { getMsgId } from '@/utils/messgae';

export const ERROR_STATUS = {
  NOAUTH: '_NO_AUTH_',
  SSEERROR: '_SSE_ERROR_',
  TIMEOUT: '_TIMEOUT_',
};

const REQ_TIMEOUT = 1200000; // 二十分钟
export default class SendHelper {
  sendingMap = new Map<
    string,
    {
      abortController: AbortController;
      timer: NodeJS.Timeout;
    }
  >();

  // abortController: AbortController | undefined = undefined;

  timer: NodeJS.Timeout | undefined = undefined;

  /** 默认请求地址 */
  url: string = '/byaiService/chat/superAgentChat';

  constructor(url?: string) {
    if (url) {
      this.url = url;
    }
  }

  clearAbortController(key: string) {
    console.log('clearAbortController----');
    if (!this.sendingMap.has(key)) return;
    const { abortController, timer } = this.sendingMap.get(key)!;
    if (abortController && abortController.abort) {
      try {
        abortController.abort();
        this.sendingMap.delete(key);
      } catch (e) {
        console.error(e);
      }
    }

    if (timer) {
      clearTimeout(timer);
    }
  }

  send(
    data: any,
    params: {
      callback?: (formatMessage: any, msg: { data: string; event: string; id: string }) => void;
    } & { [key in string]: unknown },
    fetchOpt: {
      useEventSource?: boolean;
    } = {}
  ) {
    const key = getMsgId();
    const abortController = new AbortController();
    const { signal } = abortController;
    const { callback } = params;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(ERROR_STATUS.TIMEOUT);
        this.clearAbortController(key);
      }, REQ_TIMEOUT);

      this.sendingMap.set(key, { abortController, timer });

      const headers = {
        'Content-Type': 'application/json',
        language: getLocale(),
        accessTerminal: 'Web',
        [tokenKey]: getToken(),
        [ssotokenKey]: getssoToken(),
      };

      const body = {
        ...data,
        language: getLocale(),
      };

      // 接口签名
      const signatureHeaders = generateSignature('POST', body);
      Object.assign(headers, signatureHeaders);

      fetchEventSource(this.url, {
        signal,
        method: 'POST',
        body: JSON.stringify(body),
        headers,
        openWhenHidden: true, // 窗口切换时不需要断开
        onopen: (res) => {
          console.log('---------- onopen', res);
          if (res.status === 401 || res.status === 403) {
            globalLogout();
            // eslint-disable-next-line prefer-promise-reject-errors
            return Promise.reject(ERROR_STATUS.NOAUTH);
          }

          if (res.status !== 200) {
            // eslint-disable-next-line prefer-promise-reject-errors
            return Promise.reject(`${res.status}`);
          }

          return Promise.resolve();
        },
        onclose: () => {
          console.log('onclose');
        },
        onmessage: (msg: { data: string; event: string; id: string }) => {
          if (this.timer) {
            clearTimeout(this.timer);
          }
          console.log(' *** msg:', msg, '***');
          const eventName = msg.event;

          if (['moduleStatus'].includes(eventName)) return;

          let res: any = {};
          try {
            res = JSON.parse(msg.data) || {};
          } catch (e) {
            // reject();
            console.error(e, msg);
            return;
          }

          const payload = {};

          switch (eventName) {
            case 'createSession': {
              Object.assign(payload, { ...res });
              break;
            }
            case 'initMessage': {
              Object.assign(payload, { ...res });
              break;
            }
            case 'initialization': {
              Object.assign(payload, { ...res });
              break;
            }
            case 'answerStart':
            case 'answerDelta':
            case 'answerEnd': {
              Object.assign(payload, answerDeltaHandler(res, eventName));
              Object.assign(payload, pick(res, ['messageId', 'queryMessageId', 'metadata']));
              break;
            }
            case 'reasoningLogStart':
            case 'reasoningLogDelta':
            case 'reasoningLogEnd': {
              Object.assign(payload, reasoningLogHandler(res, eventName));
              Object.assign(payload, pick(res, ['messageId', 'queryMessageId', 'metadata']));
              break;
            }
            case 'resComComplete':
              // resComIds原本写在appStreamResponse中，但是返回比较慢，会影响执行规则的传参，所以后端放在resComComplete返回了
              if (res) {
                try {
                  set(payload, 'resComIds', res);
                } catch (e) {
                  console.error(e);
                }
              }
              break;
            case 'appStreamResponse': {
              const { messageId, relatedResources, queryMessageId, relatedQuestions } = res;
              set(payload, 'messageId', messageId);
              set(payload, 'queryMessageId', queryMessageId);

              set(payload, 'message', {
                contentType: SSEMessageType.appStreamResponse,
                content: {
                  substance: {
                    relatedResources,
                    relatedQuestions,
                  },
                },
                status: SSEEventStatus.done,
              });

              break;
            }
            case 'error':
              set(payload, 'message', {
                contentType: SSEMessageType.error,
                content: {
                  substance: {
                    msg: get(res, 'message'),
                    traceback: get(res, 'traceback'),
                  },
                },
                status: SSEEventStatus.done,
              });
              break;
            default:
              break;
          }

          if (!isEmpty(payload)) {
            callback?.(payload, msg);
          }

          if (['error'].includes(eventName)) {
            this.clearAbortController(key);
            reject(ERROR_STATUS.SSEERROR);
          }

          if (['appStreamResponse'].includes(eventName)) {
            this.clearAbortController(key);
            resolve({});
          }
        },
        onerror: (err) => {
          // 源码需在此处错误，否则会一直重新请求
          throw err;
        },
        ...fetchOpt,
      })
        .then(() => {
          resolve({});
        })
        .catch((e) => {
          reject(get(e, 'message', e));
        });
    });

    return {
      promise,
      cancel: this.clearAbortController.bind(this, key),
    };
  }
}
