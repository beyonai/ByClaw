package com.iwhalecloud.byai.gateway.channels.service;

import com.iwhalecloud.byai.gateway.channels.enums.ChannelType;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;

import java.io.OutputStream;

/**
 * 渠道服务接口
 *
 * @author byai
 * @version 1.0
 * @date 2026/4/7
 */
public interface ChannelService {

    /**
     * 获取渠道类型
     *
     * @return 渠道类型
     */
    ChannelType getChannelType();

    /**
     * 处理对话请求
     *
     * @param assistantChatDto 对话请求参数
     * @param outputStream     输出流
     */
    void chat(AssistantChatDto assistantChatDto, OutputStream outputStream);

    /**
     * 验证请求参数
     *
     * @param assistantChatDto 对话请求参数
     * @return 是否验证通过
     */
    boolean validateRequest(AssistantChatDto assistantChatDto);
}
