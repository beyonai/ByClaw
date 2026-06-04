package com.iwhalecloud.byai.state.domain.chat.enums;

public enum MessageType {
    LLM_MESSAGE,     // 获取新消息
    HEARTBEAT, //心跳
    SSE_STREAM,
    NOTIFICATION, // 通知
    STOP_CHAT,
    ECOSYSTEM_BRIDGE, // 生态采集 Browser Bridge 长连接任务通道
    ERROR;
}
