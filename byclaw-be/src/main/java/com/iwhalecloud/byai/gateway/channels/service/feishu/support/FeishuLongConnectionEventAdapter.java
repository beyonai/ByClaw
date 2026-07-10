package com.iwhalecloud.byai.gateway.channels.service.feishu.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuRobotChannelConfig;
import com.lark.oapi.event.model.Header;
import com.lark.oapi.service.im.v1.model.EventMessage;
import com.lark.oapi.service.im.v1.model.EventSender;
import com.lark.oapi.service.im.v1.model.P2MessageReceiveV1;
import com.lark.oapi.service.im.v1.model.P2MessageReceiveV1Data;
import com.lark.oapi.service.im.v1.model.UserId;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 飞书长连接事件适配器。
 *
 * <p>飞书官方 SDK 通过强类型对象接收长连接事件；历史 HTTP 回调链路则已经围绕
 * {@code header + event} 的 JsonNode 结构完成了解析、去重、用户匹配和回复。
 * 这里把 SDK 事件转换回同一份 JSON 结构，让长连接和 HTTP 回调共用同一个业务处理器。</p>
 */
@Component
public class FeishuLongConnectionEventAdapter {

    private static final String MESSAGE_RECEIVE_EVENT = "im.message.receive_v1";

    private final ObjectMapper objectMapper;

    public FeishuLongConnectionEventAdapter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public JsonNode toEventRoot(P2MessageReceiveV1 event, FeishuRobotChannelConfig config) {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("schema", nullToEmpty(event == null ? null : event.getSchema()));
        root.set("header", buildHeader(event == null ? null : event.getHeader(), config));
        root.set("event", buildEvent(event == null ? null : event.getEvent()));
        return root;
    }

    private ObjectNode buildHeader(Header header, FeishuRobotChannelConfig config) {
        ObjectNode headerNode = objectMapper.createObjectNode();
        headerNode.put("event_id", nullToEmpty(header == null ? null : header.getEventId()));
        headerNode.put("event_type", resolveText(header == null ? null : header.getEventType(), MESSAGE_RECEIVE_EVENT));
        headerNode.put("app_id", resolveText(header == null ? null : header.getAppId(),
                config == null ? null : config.getAppId()));
        headerNode.put("tenant_key", nullToEmpty(header == null ? null : header.getTenantKey()));
        headerNode.put("create_time", nullToEmpty(header == null ? null : header.getCreateTime()));
        headerNode.put("token", nullToEmpty(header == null ? null : header.getToken()));
        return headerNode;
    }

    private ObjectNode buildEvent(P2MessageReceiveV1Data eventData) {
        ObjectNode eventNode = objectMapper.createObjectNode();
        eventNode.set("sender", buildSender(eventData == null ? null : eventData.getSender()));
        eventNode.set("message", buildMessage(eventData == null ? null : eventData.getMessage()));
        return eventNode;
    }

    private ObjectNode buildSender(EventSender sender) {
        ObjectNode senderNode = objectMapper.createObjectNode();
        senderNode.set("sender_id", buildSenderId(sender == null ? null : sender.getSenderId()));
        senderNode.put("sender_type", nullToEmpty(sender == null ? null : sender.getSenderType()));
        senderNode.put("tenant_key", nullToEmpty(sender == null ? null : sender.getTenantKey()));
        return senderNode;
    }

    private ObjectNode buildSenderId(UserId senderId) {
        ObjectNode senderIdNode = objectMapper.createObjectNode();
        senderIdNode.put("user_id", nullToEmpty(senderId == null ? null : senderId.getUserId()));
        senderIdNode.put("open_id", nullToEmpty(senderId == null ? null : senderId.getOpenId()));
        senderIdNode.put("union_id", nullToEmpty(senderId == null ? null : senderId.getUnionId()));
        return senderIdNode;
    }

    private ObjectNode buildMessage(EventMessage message) {
        ObjectNode messageNode = objectMapper.createObjectNode();
        messageNode.put("message_id", nullToEmpty(message == null ? null : message.getMessageId()));
        messageNode.put("root_id", nullToEmpty(message == null ? null : message.getRootId()));
        messageNode.put("parent_id", nullToEmpty(message == null ? null : message.getParentId()));
        messageNode.put("create_time", nullToEmpty(message == null ? null : message.getCreateTime()));
        messageNode.put("update_time", nullToEmpty(message == null ? null : message.getUpdateTime()));
        messageNode.put("chat_id", nullToEmpty(message == null ? null : message.getChatId()));
        messageNode.put("thread_id", nullToEmpty(message == null ? null : message.getThreadId()));
        messageNode.put("chat_type", nullToEmpty(message == null ? null : message.getChatType()));
        messageNode.put("message_type", nullToEmpty(message == null ? null : message.getMessageType()));
        messageNode.put("content", nullToEmpty(message == null ? null : message.getContent()));
        messageNode.put("user_agent", nullToEmpty(message == null ? null : message.getUserAgent()));

        if (message != null && message.getMentions() != null) {
            messageNode.set("mentions", objectMapper.valueToTree(message.getMentions()));
        }
        if (message != null && message.getLarkAgentContext() != null) {
            messageNode.set("lark_agent_context", objectMapper.valueToTree(message.getLarkAgentContext()));
        }
        return messageNode;
    }

    private String resolveText(String value, String fallback) {
        return StringUtils.hasText(value) ? value : nullToEmpty(fallback);
    }

    private String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
