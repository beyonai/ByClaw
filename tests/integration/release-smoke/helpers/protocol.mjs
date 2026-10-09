const object = (value) => {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' ? value : {};
};
const id = (value) => value === undefined || value === null ? '' : String(value);

export class TurnTracker {
  constructor(employee) {
    this.employee = employee;
    this.requestIds = new Set();
    this.sessionId = '';
    this.messageId = '';
    this.clientMessageId = '';
    this.done = false;
    this.error = '';
    this.sent = false;
    this.observedAgent = false;
    this.events = [];
  }

  outgoing(raw) {
    const data = object(raw);
    if (data.type && data.type !== 'LLM_MESSAGE') return;
    if (!data.chatContent) return;
    this.sent = true;
    this.clientMessageId = id(data.clientRequestId).split('_')[1] || '';
    if (data.sessionId || data.chatId) this.error = '请求复用了已有会话，未清理该会话';
    const agents = (data.resourceList || []).filter((item) => item.resourceType === 'DIG_EMPLOYEE');
    if (agents.length !== 1 || !this.employee.ids.some((key) => [agents[0]?.id, agents[0]?.resourceId, agents[0]?.resourceCode].map(id).includes(key))) {
      this.error = '本轮请求没有准确且唯一地 @ 目标员工';
    }
    for (const key of [data.clientRequestId, data.extParams?.requestId]) if (key) this.requestIds.add(id(key));
    for (const lane of data.extParams?.multiAgent?.lanes || []) {
      if (lane.clientRequestId) this.requestIds.add(id(lane.clientRequestId));
    }
  }

  incoming(raw) {
    const outer = object(raw);
    let data = object(outer.data);
    const event = outer.event || data.event;
    if (!event || !this.sent) return;
    if (!outer.event && data.event) data = object(data.data);
    const metadata = { ...object(data.metadata), ...object(data.data?.metadata) };
    const requestId = id(outer.clientRequestId || data.clientRequestId || data.data?.clientRequestId || metadata.clientRequestId || outer.requestId || data.requestId);
    const sessionId = id(outer.sessionId || outer.chatId || data.sessionId || data.chatId || data.data?.sessionId);
    // Reject another turn even if it happens to share the same session.
    if (requestId && this.requestIds.size && !this.requestIds.has(requestId)) return;
    if (!requestId && (!this.sessionId || sessionId !== this.sessionId)) {
      // A fresh context has no subscribed old session; its creation frame owns this request.
      if (event !== 'createSession' && event !== 'initialization') return;
      if (!sessionId) return;
    }
    if (this.sessionId && sessionId && sessionId !== this.sessionId) {
      this.error = '当前请求出现多个会话，保留会话供排查';
      return;
    }
    if (sessionId) this.sessionId = sessionId;
    const agent = id(outer.agentId || data.agentId || data.agentCode || data.data?.agentId || metadata.agentId || metadata.agentCode);
    if (agent) {
      if (!this.employee.ids.includes(agent)) this.error = '收到非目标员工的回复';
      else this.observedAgent = true;
    }
    if (this.events.length < 100) this.events.push({ event, sessionId, requestId, agentId: agent });
    if (event === 'error' || outer.type === 'ERROR') this.error = '对话流返回执行或权限错误';
    if (event === 'appStreamResponse') {
      this.done = true;
      this.messageId = id(data.messageId || data.modelAnswerMessageId || outer.messageId);
    }
  }
}

export function businessData(body) {
  if (!body || String(body.code) !== '0') throw new Error('接口返回业务失败');
  return body.data;
}

export function mayDelete(result, tracker, createdIds) {
  return result.status === 'passed' && tracker.sent && tracker.done && !tracker.error &&
    Boolean(tracker.sessionId) && createdIds.has(tracker.sessionId);
}
