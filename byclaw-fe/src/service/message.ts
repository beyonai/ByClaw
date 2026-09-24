import { GET, POST } from '@/service/common/request';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

export const getMessages = (payload: { sessionId: string; pageNum?: number; pageSize?: number; messageId?: string }) =>
  POST<any>('/byaiService/assiman/getMessages', {
    ...payload,
  });

export type ConversationOutlineItem = {
  messageId: string;
  role?: string;
  usage: number;
  content?: string;
  displayContent?: string;
  creatorName?: string;
  createTime?: string;
  position: number;
  totalCount: number;
};

export const getMessageOutline = (sessionId: string) =>
  POST<ConversationOutlineItem[]>('/byaiService/assiman/getMessageOutline', { sessionId });
export const getMessageById = (payload: { messageId: string }) =>
  POST<any>('/byaiService/chat/getMessageById', {
    ...payload,
  });

export type SessionModelConfirmPayload = {
  sessionId: string | number;
  modelId: string;
  thinkingLevel?: string;
};

/** 在发送消息前确认会话模型运行状态，触发沙箱侧的事件驱动预热。 */
export const confirmSessionModel = (payload: SessionModelConfirmPayload) =>
  POST<{ changed: boolean; revision: number; changeMask: string[] }>('/byaiService/chat/sessionModel', payload);

type SessionModelConfirmQueue = {
  inFlight: Omit<SessionModelConfirmPayload, 'sessionId'>;
  pendingLatest?: Omit<SessionModelConfirmPayload, 'sessionId'>;
};

const sessionModelConfirmQueues = new Map<string, SessionModelConfirmQueue>();
const SESSION_MODEL_CONFIRM_RETRY_DELAYS_MS = [120, 300];

const normalizeSessionModelSelection = (
  selection: Omit<SessionModelConfirmPayload, 'sessionId'>
): Omit<SessionModelConfirmPayload, 'sessionId'> => {
  const modelId = `${selection.modelId || '-1'}`.trim() || '-1';
  const thinkingLevel = `${selection.thinkingLevel || ''}`.trim();
  return { modelId, ...(thinkingLevel ? { thinkingLevel } : {}) };
};

const sameSessionModelSelection = (
  left: Omit<SessionModelConfirmPayload, 'sessionId'> | undefined,
  right: Omit<SessionModelConfirmPayload, 'sessionId'> | undefined
) => left?.modelId === right?.modelId && left?.thinkingLevel === right?.thinkingLevel;

const waitForSessionModelRetry = (delayMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });

const drainSessionModelConfirmQueue = async (
  sessionId: string | number,
  queue: SessionModelConfirmQueue,
  initial: Omit<SessionModelConfirmPayload, 'sessionId'>
) => {
  let next: Omit<SessionModelConfirmPayload, 'sessionId'> | undefined = initial;
  while (next) {
    queue.inFlight = next;
    let delivered = false;
    let lastError: unknown;
    for (let attempt = 0; attempt <= SESSION_MODEL_CONFIRM_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await confirmSessionModel({ sessionId, ...next });
        delivered = true;
        break;
      } catch (error) {
        lastError = error;
        // 新选择已经到来时不重试旧状态，立即让 latest-wins 队列处理新值。
        if (queue.pendingLatest && !sameSessionModelSelection(queue.pendingLatest, next)) break;
        const delayMs = SESSION_MODEL_CONFIRM_RETRY_DELAYS_MS[attempt];
        if (delayMs === undefined) break;
        await waitForSessionModelRetry(delayMs);
        if (queue.pendingLatest && !sameSessionModelSelection(queue.pendingLatest, next)) break;
      }
    }
    if (!delivered && !queue.pendingLatest) {
      // eslint-disable-next-line no-console
      console.warn(`Session model confirmation failed after bounded retries for session ${sessionId}`, lastError);
    }
    next = queue.pendingLatest;
    queue.pendingLatest = undefined;
  }
  if (sessionModelConfirmQueues.get(`${sessionId}`) === queue) sessionModelConfirmQueues.delete(`${sessionId}`);
};

/** 新会话还没有服务端 sessionId，首条消息仍由原发送链路完成权威保存。 */
export const confirmExistingSessionModel = (
  sessionId: string | number | null | undefined,
  selection: Omit<SessionModelConfirmPayload, 'sessionId'>
) => {
  if (sessionId === undefined || sessionId === null || `${sessionId}` === 'new' || !/^\d+$/.test(`${sessionId}`)) {
    return false;
  }
  const normalized = normalizeSessionModelSelection(selection);
  const key = `${sessionId}`;
  const active = sessionModelConfirmQueues.get(key);
  if (active) {
    if (sameSessionModelSelection(active.inFlight, normalized)) {
      // 用户最终又选回正在提交的值：清除中间 pending，不再制造额外 no-op 请求。
      active.pendingLatest = undefined;
      return true;
    }
    if (sameSessionModelSelection(active.pendingLatest, normalized)) return true;
    // A 请求尚未完成时，B/C 等中间态只保留最后一次 C，兼顾顺序和响应速度。
    active.pendingLatest = normalized;
    return true;
  }
  const queue: SessionModelConfirmQueue = { inFlight: normalized };
  sessionModelConfirmQueues.set(key, queue);
  // 不消费响应来回写 UI；同一会话始终只有一个在途请求，旧响应无法覆盖最新选择。
  void drainSessionModelConfirmQueue(sessionId, queue, normalized);
  return true;
};

export const getTraceIdByMessageId = (messageId: string) =>
  GET<string>(`/byaiService/chat/getTraceIdByMessageId?messageId=${encodeURIComponent(messageId)}`);

export const qryTroubleshootSession = (payload: { messageId: string | number }) =>
  POST<any>('/byaiService/assiman/qryTroubleshootSession', {
    ...payload,
  });

export const updateMesFeedback = (data: any) =>
  POST<any>('/byaiService/assiman/updateMesFeedback', data, withCustomHandle);

// 删除回答消息
export const delMessage = (data: any) => POST<any>('/byaiService/assiman/deleteMessage', data);

// 获取反馈类型字典列表
export const getContentFeedbackType = () => GET<any>('/byaiService/assiman/getContentFeedbackType');

// 获取反馈类型字典列表
export const getForwardMessage = (messageId: string, cancelToken?: AbortController) =>
  GET<any>(`/byaiService/assiman/getForwardMessage/${messageId}`, {}, { cancelToken });

// 模糊查询数字员工和企业员工
export const findAssiman = (payload: any = {}) => POST<any>('/byaiService/assiman/find', { ...payload });

export const createGroupChat = (payload: any = {}) => POST<any>('/byaiService/group/createGroupChat', payload);

export const addMessage = (payload: any = {}) => POST<any>('/byaiService/group/addMessage', payload);

// 获取消息卡片的状态
export const getMessageState = (payload: { resComIds: string[] }) =>
  POST<any>('/byaiService/menTaskController/getResComList', {
    ...payload,
  });

// 收藏
export const collectCase = (payload: any) =>
  POST<any>('/byaiService/showcase/create', {
    ...payload,
  });
// 取消收藏
export const cancelCollectCase = (payload: any) =>
  POST<any>('/byaiService/showcase/cancelCollect', {
    ...payload,
  });

export const getChatHistory = (payload: any) =>
  POST<any>('/byaiService/showcase/getChatHistory', {
    ...payload,
  });

export const stopChat = (payload: any) =>
  POST<any>('/byaiService/chat/stopChat', {
    ...payload,
  });

export const getChatRunningStatus = (payload: { sessionIds: Array<string | number> }) =>
  POST<any>('/byaiService/chat/runningStatus', {
    ...payload,
  });

export const getChatRunningSnapshot = (payload: {
  sessionId: string | number;
  traceId?: string;
  modelAnswerMessageId?: string | number;
}) =>
  POST<any>('/byaiService/chat/runningSnapshot', {
    ...payload,
  });

export const getMessageByIds = (payload: any) =>
  POST<any>('/byaiService/assiman/getMessageByIds', {
    ...payload,
  });

export const getSandboxInfo = (payload: any) =>
  POST<any>('/byaiService/sandbox/getSandboxInfo', {
    ...payload,
  });

export const updateMessageStructById = (payload: any) =>
  POST<any>('/byaiService/chat/updateMessageStructById', {
    ...payload,
  });

export const getTermsOptions = (payload: {
  termSet: string;
  termTypeCode: string;
  termField: string;
  datasetId: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) =>
  POST<any>('/byaiService/chat/getTermsOptions', {
    ...payload,
    page: payload.page || 1,
    pageSize: payload.pageSize || 20,
    keyword: payload.keyword || '',
    datasetId: payload.datasetId || 0,
  });
