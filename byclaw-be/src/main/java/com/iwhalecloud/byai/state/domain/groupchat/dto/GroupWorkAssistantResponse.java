package com.iwhalecloud.byai.state.domain.groupchat.dto;

/** 创建群前展示的默认助手，仅返回公开展示字段，ID 使用字符串。 */
public record GroupWorkAssistantResponse(String resourceId, String resourceName, String resourceDesc, String avatar) {}
