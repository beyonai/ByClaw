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

    public static final String FEISHU_CHAT_ID = "feishu.chatId";
    public static final String FEISHU_CHAT_TYPE = "feishu.chatType";
    public static final String FEISHU_MESSAGE_ID = "feishu.messageId";
    public static final String FEISHU_SENDER_OPEN_ID = "feishu.senderOpenId";
    public static final String FEISHU_SENDER_UNION_ID = "feishu.senderUnionId";
    
    public static final String WECOM_BOT_ID = "wecom.botId";
    public static final String WECOM_CHAT_ID = "wecom.chatId";
    public static final String WECOM_CHAT_TYPE = "wecom.chatType";
    public static final String WECOM_USER_ID = "wecom.userId";
    public static final String WECOM_MESSAGE_ID = "wecom.messageId";

    private ChatChannelExtensionKeys() {
    }
}
