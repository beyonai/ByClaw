package com.iwhalecloud.byai.state.domain.chat.enums;

public enum MessageType {
    LLM_MESSAGE,     // 获取新消息
    HEARTBEAT, //心跳
    SSE_STREAM,
    NOTIFICATION, // 通知
    ERROR;
}