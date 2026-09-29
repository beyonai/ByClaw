package com.iwhalecloud.byai.state.domain.groupchat.dto;

/** 返回文件记录的交付事实，不代表允许直接发布。ID 使用字符串保持前端精度。 */
public record GroupChatTaskDeliveryResponse(String taskId, boolean delivered) {
}
