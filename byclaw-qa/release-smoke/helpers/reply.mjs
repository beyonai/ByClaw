export function validateReply(detail, tracker) {
  if (String(detail?.sessionId || '') !== tracker.sessionId) throw new Error('最终消息不属于本轮会话');
  if (String(detail?.messageId || '') !== tracker.messageId) throw new Error('最终消息标识不匹配');
  if (String(detail?.usage) !== '2') throw new Error('最终消息不是员工回答');
  // Older deployments leave isComplete=false even after msgStatus=0. The final
  // stream event plus persisted FINISH status is the authoritative completion.
  if (String(detail?.msgStatus) !== '0' && detail?.isComplete !== true) throw new Error('最终消息尚未完成');
  let metadata = detail?.metadata || {};
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
  }
  if (metadata.turnFailed === true) throw new Error('最终消息标记为执行失败');
  const agentId = String(metadata.agentId || metadata.agentCode || detail?.agentId || detail?.agentCode || '');
  if (agentId && !tracker.employee.ids.includes(agentId)) throw new Error('最终消息来自非目标员工');
  if (!agentId && !tracker.observedAgent) throw new Error('无法确认回复来自目标员工');
  // Explicit empty finalContent must never fall back to intermediate output.
  const rawText = detail?.finalContent ?? detail?.messageContent;
  if (typeof rawText !== 'string') throw new Error('最终回答为空');
  // The web renderer hides complete think blocks. They are not final answers.
  const text = rawText.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<think\b[^>]*>[\s\S]*$/gi, '').trim();
  if (!text) throw new Error('最终回答为空');
  if (/系统繁忙|服务不可用|无权限|没有.*权限|请求失败|发生错误|internal server error|unauthorized|permission denied/i.test(text)) {
    throw new Error('回答正文包含服务或权限异常');
  }
  return text.trim();
}

export function normalizedText(text) {
  return text.replace(/[\s*_`#>~]/g, '');
}
