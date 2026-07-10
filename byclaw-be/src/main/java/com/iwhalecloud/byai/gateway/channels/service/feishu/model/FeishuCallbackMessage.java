package com.iwhalecloud.byai.gateway.channels.service.feishu.model;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Getter;
import lombok.Setter;

/**
 * 飞书消息事件在业务层使用的归一化模型。
 *
 * <p>飞书事件原始结构层级较深，且 content 里的 text 本身还是 JSON 字符串。
 * 监听器只消费这个对象，可以避免业务代码散落大量 JsonNode path 解析。</p>
 */
@Getter
@Setter
public class FeishuCallbackMessage {

    private String eventId;
    private String appId;
    private String tenantKey;
    private String messageId;
    private String chatId;
    private String chatType;
    private String messageType;
    private String textContent;
    private String senderOpenId;
    private String senderUnionId;
    private String senderUserId;
    private String senderType;
    /**
     * 飞书群聊消息中的 @ 列表。单聊通常为空。
     */
    private JsonNode mentions;
    /**
     * 群聊消息是否明确 @ 了当前机器人。
     */
    private boolean mentionedBot;
    private Object rawEvent;
}
