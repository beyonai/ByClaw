import { fetchEventSource } from '@fortaine/fetch-event-source';
import { get, isNil } from 'lodash';
import { getLocale } from '@umijs/max';

import { POST } from '@/service/common/request';

import { generateUniqueId } from '@/utils/math';

export default function fetchPureText(params: {
  url: string;
  body: any;
  callback: (text: string) => void;
  timeout?: number;
}) {
  const { url, body, callback, timeout = 60000 } = params;

  let abortController: AbortController | undefined = new AbortController();
  const { signal } = abortController;

  let timer: number | undefined;

  const requestId = generateUniqueId(10);

  const cancelSse = () => {
    try {
      if (window.navigator && window.navigator.sendBeacon) {
        const p = JSON.stringify({ requestId });
        window.navigator.sendBeacon(
          '/knowledgeService/callDomainService/cancelSse',
          p,
        );
      } else {
        POST('knowledgeService/callDomainService/cancelSse', {
          requestId,
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const cancel = (reason?: any) => {
    try {
      if (abortController && !abortController.signal.aborted) {
        abortController.abort(reason);
        abortController = undefined;

        cancelSse();
      }
    } catch (e) {
      console.error(e);
    }

    window.clearTimeout(timer);
  };

  const promise = new Promise<string>((resolve, reject) => {
    timer = window.setTimeout(() => {
      const err = new DOMException('service timeout', 'TimeoutError');
      cancel(err);
      reject(err);
    }, timeout);

    const myBody = JSON.stringify({ ...body, requestId, language: getLocale() });

    fetchEventSource(url, {
      body: myBody,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        language: getLocale(),
      },
      signal,
      openWhenHidden: true, // 窗口切换时不需要断开
      onmessage: (msg: { data: string; event: string; id: string }) => {
        window.clearTimeout(timer);

        if (msg.data === '[DONE]') {
          resolve('');
          return;
        }

        try {
          const res = JSON.parse(msg.data) || {};

          const text = get(res, 'choices.0.delta.content', '');

          callback(isNil(text) ? '' : text);
        } catch (e) {
          console.error(e);
        }
      },
      onclose: () => {
        console.log('fetchPureText onclose');
        resolve('');
      },
      onerror: (err: Error) => {
        console.error('fetchPureText onerror', err);

        cancel();
        reject(err);

        throw err;
      },
    });
  });
  return {
    cancel,
    promise,
  };
}
