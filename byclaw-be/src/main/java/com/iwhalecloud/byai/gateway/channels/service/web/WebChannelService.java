package com.iwhalecloud.byai.gateway.channels.service.web;

import com.iwhalecloud.byai.gateway.channels.enums.ChannelType;
import com.iwhalecloud.byai.gateway.channels.service.ChannelService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.OutputStream;

/**
 * Web 渠道服务实现
 *
 * @author byai
 * @version 1.0
 * @date 2026/4/7
 */
@Slf4j
@Service
public class WebChannelService implements ChannelService {

    @Autowired
    private AssistantChatService assistantChatService;

    @Override
    public ChannelType getChannelType() {
        return ChannelType.WEB;
    }

    @Override
    public void chat(AssistantChatDto assistantChatDto, OutputStream outputStream) {
        log.info("Web渠道处理对话请求, assistantId: {}", assistantChatDto.getAssistantId());
        try {
            assistantChatService.chat(assistantChatDto, outputStream, null);
        } catch (IOException e) {
            log.error("Web渠道对话处理异常, assistantId: {}", assistantChatDto.getAssistantId(), e);
            throw new RuntimeException(e);
        }
    }

    @Override
    public boolean validateRequest(AssistantChatDto assistantChatDto) {
        // Web 渠道特定的参数验证逻辑
        return assistantChatDto != null && assistantChatDto.getChatContent() != null;
    }
}
