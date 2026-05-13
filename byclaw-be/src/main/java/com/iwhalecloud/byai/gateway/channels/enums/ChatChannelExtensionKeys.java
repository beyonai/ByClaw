package com.iwhalecloud.byai.gateway.channels.enums;

/**
 * {@link com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto#getChannelExtension()} 中使用的键名约定，
 * 合并入 Gateway SDK 发送消息时的 metadata。
 */
public final class ChatChannelExtensionKeys {

    /** 与 {@link ChannelType#getCode()} 对齐，如 web / app / dingtalk */
    public static final String CHANNEL_TYPE = "channelType";

    public static final String DINGTALK_CONVERSATION_TYPE = "dingtalk.conversationType";
    public static final String DINGTALK_CONVERSATION_ID = "dingtalk.conversationId";
    public static final String DINGTALK_SENDER_STAFF_ID = "dingtalk.senderStaffId";

    private ChatChannelExtensionKeys() {
    }
}
