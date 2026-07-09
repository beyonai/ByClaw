package com.iwhalecloud.byai.gateway.channels.service.wecom;

import com.iwhalecloud.byai.gateway.channels.enums.ChannelType;
import com.iwhalecloud.byai.gateway.channels.service.ChannelService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import org.apache.commons.collections.CollectionUtils;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.io.OutputStream;

/**
 * WeCom (企业微信) channel service. Mirrors {@code DingtalkChannelService} but
 * with an explicit {@link #validateRequest} (plan §Task 10 / codex): DingTalk
 * only checks {@code chatContent}, which is too weak for WeCom's file/voice/
 * empty-text messages.
 *
 * <p>Registered in {@code ChannelServiceFactory} (manual registration — the
 * factory does not auto-discover). Without that, {@code getService("wecom")}
 * throws and every WeCom chat fails.
 */
@Slf4j
@Service
public class WecomChannelService implements ChannelService {

    @Autowired
    private AssistantChatService assistantChatService;

    @Override
    public ChannelType getChannelType() {
        return ChannelType.WECOM;
    }

    @Override
    public void chat(AssistantChatDto assistantChatDto, OutputStream outputStream) {
        log.info("WeCom channel handling chat. agentId={}", assistantChatDto.getAgentId());
        try {
            assistantChatService.chat(assistantChatDto, outputStream, null);
        } catch (IOException e) {
            log.error("WeCom channel chat failed. agentId={}", assistantChatDto.getAgentId(), e);
            throw new RuntimeException(e);
        }
    }

    @Override
    public boolean validateRequest(AssistantChatDto assistantChatDto) {
        if (assistantChatDto == null) {
            return false;
        }
        if (!ChannelType.WECOM.getCode().equals(assistantChatDto.getAccessTerminal())) {
            return false;
        }
        if (assistantChatDto.getAgentId() == null
                || assistantChatDto.getSessionId() == null
                || !StringUtils.hasText(assistantChatDto.getClientRequestId())) {
            return false;
        }
        boolean hasContent = StringUtils.hasText(assistantChatDto.getChatContent());
        boolean hasFiles = CollectionUtils.isNotEmpty(assistantChatDto.getFiles());
        return hasContent || hasFiles;
    }
}
