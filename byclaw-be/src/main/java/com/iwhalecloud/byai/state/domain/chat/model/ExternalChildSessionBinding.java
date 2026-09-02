package com.iwhalecloud.byai.state.domain.chat.model;

import com.iwhalecloud.byai.manager.entity.session.ByaiSession;

/**
 * ByClaw 子会话与外部执行器子会话的持久化绑定。
 *
 * @param session ByClaw 子会话
 * @param externalSessionId 外部子会话标识
 * @param messageId 子会话内承载外部输出的消息标识
 */
public record ExternalChildSessionBinding(ByaiSession session, String externalSessionId, Long messageId) {
}
