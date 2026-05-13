import { trackerElementMap } from '@/constants/tracker';
import { generateUniqueId } from '@/utils/math';
import { POST } from '@/service/common/request';
import { get, isFunction } from 'lodash';

type ITrackerData = {
  eventCode: string;
  eventName: string;
  eventType: 'CLICK' | 'VIEW' | 'INPUT' | 'SUBMIT' | 'EXPOSE' | 'CLOSE';
  elementId: string;
  elementCode: string;
  elementName: string;
  objectId: string;
  objectType:
    | 'AGENT'
    | 'DIG_EMPLOYEE'
    | 'MCP'
    | 'TOOL'
    | 'MCP_TOOL'
    | 'TOOLKIT'
    | 'KG_DOC'
    | 'KG_DB'
    | 'KG_TERM'
    | 'KG_QA'
    | 'VIEW'
    | 'OBJECT'
    | 'ACTION';
  pagePath: string;
  pageTitle: string;
};

const MAX_BATCH_SIZE = 10;
const FLUSH_INTERVAL = 5000; // 5秒批量发送一次
const sendURL = '/byaiService/trackLogController/batchSaveTrackLog';

export class Tracker {
  worker: Worker | null = null;

  queue: any[] = [];

  timer: NodeJS.Timeout | null = null;

  isFlushing: boolean = false;

  constructor() {
    this.send = this.send.bind(this);
    this.init();
  }

  init() {
    // 页面卸载前确保发送所有数据
    window.addEventListener('beforeunload', () => {
      this.send();
      if (this.timer) {
        clearInterval(this.timer);
      }
    });

    // 页面隐藏时发送数据
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.send();
      }
    });

    this.timer = setInterval(this.send, FLUSH_INTERVAL);
  }

  send() {
    if (this.queue.length === 0 || this.isFlushing) return;

    this.isFlushing = true;

    const batch = this.queue.slice(0, MAX_BATCH_SIZE);
    this.queue = this.queue.slice(MAX_BATCH_SIZE);

    let success = false;
    if (window.navigator && isFunction(navigator.sendBeacon)) {
      let strbBatch = '';
      try {
        strbBatch = JSON.stringify({
          trackLogs: batch,
        });
        // 使用sendBeacon，即使页面关闭也能发送
        success = navigator.sendBeacon(sendURL, strbBatch);
      } catch (error) {
        console.error('sendBeacon失败:', error);
      }
    }

    if (!success) {
      POST(
        sendURL,
        {
          trackLogs: batch,
        },
        {
          responseCfg: {
            hideErrorTips: true,
          },
        }
      )
        .then(() => {
          console.log(`发送了 ${batch.length} 条埋点数据`);
        })
        .catch((error) => {
          console.error('埋点发送失败:', error);
          // 失败后重新加入队列
          this.queue = [...batch, ...this.queue];
        })
        .finally(() => {
          this.isFlushing = false;
        });

      return;
    }
    this.isFlushing = false;
  }

  track(eventType: string, data: Partial<ITrackerData> = {}) {
    this.queue.push({
      ...data,
      eventType,
      timestamp: Date.now(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
    });

    // 队列满了立即发送
    if (this.queue.length >= MAX_BATCH_SIZE) {
      this.send();
    }
  }

  flush() {}

  clear() {
    this.queue = [];
  }
}

export const getTrackerInfo = (type: keyof typeof trackerElementMap, defaultInfo: any = {}) => {
  const info = get(trackerElementMap, type) || get(trackerElementMap, 'default');
  return {
    ...info,
    elementId: `${info.elementCode}_${generateUniqueId(10)}`,
    ...defaultInfo,
  };
};

export default new Tracker();
