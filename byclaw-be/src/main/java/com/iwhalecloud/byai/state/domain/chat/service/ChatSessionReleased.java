package com.iwhalecloud.byai.state.domain.chat.service;

/** 运行槽清理完成后的本地唤醒提示；接收者必须重新检查共享运行态。 */
public record ChatSessionReleased(Long sessionId) {
}
