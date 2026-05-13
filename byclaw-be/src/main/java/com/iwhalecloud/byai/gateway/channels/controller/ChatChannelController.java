package com.iwhalecloud.byai.gateway.channels.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.IOException;
import java.io.OutputStream;

import com.iwhalecloud.byai.gateway.channels.service.ChannelService;
import com.iwhalecloud.byai.gateway.channels.service.ChannelServiceFactory;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.annotation.ChatCallLimit;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/chat")
@Tag(name = "对话渠道接口", description = "数字助理对话渠道相关接口")
public class ChatChannelController {

    private static final Logger logger = LoggerFactory.getLogger(ChatChannelController.class);

    @Operation(summary = "数字助理对话", description = "数字助理对话控制器-对话请求的接收、转发、调度，对话响应的状态、日志、最终结果和推理过程的收集、转发、整理和存储",
        responses = {
            @ApiResponse(responseCode = "0", description = "对话成功"),
            @ApiResponse(responseCode = "500", description = "服务器内部错误")
        })
    @ChatCallLimit
    @PostMapping(value = "/superAgentChat")
    public void postChat(
        @Parameter(description = "对话请求参数", required = true) @RequestBody AssistantChatDto assistantChatDto,
        HttpServletResponse response) {
        if (CurrentUserHolder.getAssistantId() == null || CurrentUserHolder.getCurrentUserName() == null) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.chat.assistant.is.null"));
        }
        try {
            CompletionsUtils.setResHeader(response, true);
            OutputStream outputStream = response.getOutputStream();

            // 根据 accessTerminal 从工厂获取对应的渠道服务
            String accessTerminal = assistantChatDto.getAccessTerminal();
            logger.info("对话请求，渠道类型: {}", accessTerminal);

            ChannelService channelService = ChannelServiceFactory.getService(accessTerminal);

            // 验证请求
            if (!channelService.validateRequest(assistantChatDto)) {
                throw new BdpRuntimeException(I18nUtil.get("assistant.chat.request.invalid"));
            }

            // 调用渠道服务的 chat 方法
            channelService.chat(assistantChatDto, outputStream);
        }
        catch (IOException e) {
            logger.error(e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("assistant.chat.network.busy"), e);
        }
    }
}
