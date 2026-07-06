package com.iwhalecloud.byai.gateway.channels.service.feishu;

import java.io.IOException;
import java.io.OutputStream;

import com.iwhalecloud.byai.gateway.channels.enums.ChannelType;
import com.iwhalecloud.byai.gateway.channels.service.ChannelService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 飞书渠道服务实现。
 *
 * <p>渠道服务只负责把已经完成鉴权、会话映射和上下文组装的请求交给统一聊天服务。
 * 飞书事件解析、用户绑定和消息发送都放在 {@code service.feishu} 下的专用服务中，
 * 这样可以保证数字员工核心聊天链路不感知具体第三方平台。</p>
 */
@Slf4j
@Service
public class FeishuChannelService implements ChannelService {

    @Autowired
    private AssistantChatService assistantChatService;

    @Override
    public ChannelType getChannelType() {
        return ChannelType.FEISHU;
    }

    @Override
    public void chat(AssistantChatDto assistantChatDto, OutputStream outputStream) {
        log.info("飞书渠道处理对话请求, assistantId: {}", assistantChatDto.getAssistantId());
        try {
            assistantChatService.chat(assistantChatDto, outputStream, null);
        } catch (IOException e) {
            log.error("飞书渠道对话处理异常, assistantId: {}", assistantChatDto.getAssistantId(), e);
            throw new RuntimeException(e);
        }
    }

    @Override
    public boolean validateRequest(AssistantChatDto assistantChatDto) {
        // 第一版飞书机器人只要求聊天内容非 null；附件、卡片动作等高级消息后续单独扩展。
        return assistantChatDto != null && assistantChatDto.getChatContent() != null;
    }
}
