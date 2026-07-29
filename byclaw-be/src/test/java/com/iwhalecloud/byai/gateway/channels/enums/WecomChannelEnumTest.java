package com.iwhalecloud.byai.gateway.channels.enums;

import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Task 1 verification: WECOM is registered across the three channel enums and
 * resolves by code / access terminal exactly like the existing channels.
 */
class WecomChannelEnumTest {

    @Test
    void channelTypeResolvesWecomByCode() {
        assertThat(ChannelType.WECOM.getCode()).isEqualTo("wecom");
        assertThat(ChannelType.WECOM.getDesc()).isEqualTo("企业微信渠道");
        assertThat(ChannelType.getByCode("wecom")).isEqualTo(ChannelType.WECOM);
        // Case-insensitive, matching the DingTalk/WEB behaviour.
        assertThat(ChannelType.getByCode("WECOM")).isEqualTo(ChannelType.WECOM);
    }

    @Test
    void channelTypeReturnsNullForUnknownCode() {
        assertThat(ChannelType.getByCode("no-such-channel")).isNull();
    }

    @Test
    void assistantAccessChannelMapsToWecomChannelType() {
        assertThat(AssistantAccessChannel.WECOM.getChannelType()).isEqualTo(ChannelType.WECOM);
        assertThat(AssistantAccessChannel.WECOM.getTypeCode()).isEqualTo("wecom");
    }

    @Test
    void fromAccessTerminalResolvesWecom() {
        Optional<AssistantAccessChannel> resolved = AssistantAccessChannel.fromAccessTerminal("wecom");
        assertThat(resolved).contains(AssistantAccessChannel.WECOM);
    }

    @Test
    void fromAccessTerminalEmptyForUnknownTerminal() {
        assertThat(AssistantAccessChannel.fromAccessTerminal("no-such-channel")).isEmpty();
    }

    @Test
    void extensionKeysUseWecomNamespace() {
        assertThat(ChatChannelExtensionKeys.WECOM_BOT_ID).isEqualTo("wecom.botId");
        assertThat(ChatChannelExtensionKeys.WECOM_CHAT_ID).isEqualTo("wecom.chatId");
        assertThat(ChatChannelExtensionKeys.WECOM_CHAT_TYPE).isEqualTo("wecom.chatType");
        assertThat(ChatChannelExtensionKeys.WECOM_USER_ID).isEqualTo("wecom.userId");
        assertThat(ChatChannelExtensionKeys.WECOM_MESSAGE_ID).isEqualTo("wecom.messageId");
    }
}
