package com.iwhalecloud.byai.gateway.channels.enums;

import java.util.HashMap;
import java.util.Optional;

import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;

/**
 * 消息接入渠道（与 {@link ChannelType} 一一对应），用于在 {@link AssistantChatDto} 的渠道扩展属性中写入统一的
 * {@link ChatChannelExtensionKeys#CHANNEL_TYPE} 等字段。
 */
public enum AssistantAccessChannel {

    WEB(ChannelType.WEB),
    APP(ChannelType.APP),
    DINGTALK(ChannelType.DINGTALK);

    private final ChannelType channelType;

    AssistantAccessChannel(ChannelType channelType) {
        this.channelType = channelType;
    }

    public ChannelType getChannelType() {
        return channelType;
    }

    /** 与 {@link ChannelType#getCode()} 一致，写入扩展属性时使用 */
    public String getTypeCode() {
        return channelType.getCode();
    }

    /**
     * 根据请求中的 accessTerminal（与 ChannelType code 对应）解析接入渠道。
     */
    public static Optional<AssistantAccessChannel> fromAccessTerminal(String accessTerminal) {
        ChannelType ct = ChannelType.getByCode(accessTerminal);
        if (ct == null) {
            return Optional.empty();
        }
        for (AssistantAccessChannel c : values()) {
            if (c.channelType == ct) {
                return Optional.of(c);
            }
        }
        return Optional.empty();
    }

    /**
     * 若扩展 Map 中尚未包含 channelType，则写入当前枚举对应的类型码（不覆盖业务已写入的钉钉等字段）。
     */
    public void ensureChannelTypeInExtension(AssistantChatDto dto) {
        if (dto == null) {
            return;
        }
        if (dto.getChannelExtension() == null) {
            dto.setChannelExtension(new HashMap<>());
        }
        dto.getChannelExtension().putIfAbsent(ChatChannelExtensionKeys.CHANNEL_TYPE, channelType.getCode());
    }
}
