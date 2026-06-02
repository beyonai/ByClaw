package com.iwhalecloud.byai.state.domain.ws.service;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.state.application.service.message.MessageService;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.manager.NettyArrayOutputStream;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;
import com.iwhalecloud.byai.state.infrastructure.utils.NettyResponse;
import com.iwhalecloud.byai.state.domain.session.dto.MessageDto;
import io.netty.channel.ChannelHandlerContext;
import lombok.extern.slf4j.Slf4j;

/**
 * WebSocket Chat Service for handling real-time chat communications.
 * <p>
 * This service provides functionality for: - Direct LLM (Large Language Model) chat interactions - SSE (Server-Sent
 * Events) stream processing
 * <p>
 * The service uses Netty's ChannelHandlerContext for non-blocking I/O operations and supports both synchronous and
 * streaming responses.
 */
@Service
@Slf4j
public class ChatService {

    @Autowired
    private AssistantChatService assistantChatService;

    @Autowired
    private MessageService messageService;

    @Autowired
    private AssistantChatApplicationService assistantChatApplicationService;

    @Autowired
    private RunningOutputStreamRegistry runningOutputStreamRegistry;

    /**
     * Handles direct chat interactions with the Large Language Model.
     * <p>
     * This method processes single chat interactions by: 1. Retrieving the current user from the channel attributes 2.
     * Creating a streaming response channel 3. Delegating the chat processing to the assistant service
     * 
     * @param ctx The Netty channel context for the connection
     * @param message The chat message containing session and content information
     * @throws IOException if there's an error in stream processing
     * @see AssistantChatService#chat(ChatMessage, NettyArrayOutputStream)
     */
    public void llmChat(ChannelHandlerContext ctx, ChatMessage message) {
        LoginInfo currentUser = ctx.channel().attr(Constant.ATT_USER_INFO).get();
        // 设置发送端 Channel，用于多端广播时排除发送端避免重复推送
        message.setSenderChannel(ctx.channel());
        try (NettyArrayOutputStream outputStream = new NettyArrayOutputStream(ctx, message.getClientRequestId(),
            "CHAT_STREAM")) {
            assistantChatService.chat(message, outputStream, currentUser);
        }
        catch (IOException e) {
            log.error("Error processing LLM chat", e);
            // 发送错误消息给客户端
            NettyResponse.sendErrorResponse(ctx, "Error processing LLM chat");
        }
    }

    /**
     * Processes SSE stream responses for chat messages.
     * <p>
     * This method handles streaming responses by: 1. Creating a message DTO with session and message IDs 2. Setting up
     * a buffered reader for the SSE stream 3. Processing and forwarding the stream content 4. Removing SSE-specific
     * formatting (e.g., "data: " prefix)
     * <p>
     * The method ensures proper resource cleanup through try-with-resources and handles error conditions appropriately.
     *
     * @param ctx The Netty channel context for the connection
     * @param message The chat message containing session and message identifiers
     * @throws IOException if there's an error in stream processing
     * @see MessageService#getSseBufferedReader(MessageDto)
     */
    public void sseStream(ChannelHandlerContext ctx, ChatMessage message) {
        MessageDto messageDto = new MessageDto();
        messageDto.setSessionId(message.getSessionId());
        messageDto.setMessageId(message.getMessageId());
        try (NettyArrayOutputStream res = new NettyArrayOutputStream(ctx);
            BufferedReader sseBufferedReader = messageService.getSseBufferedReader(messageDto)) {

            String line;
            while ((line = sseBufferedReader.readLine()) != null) {
                // 移除"data: "前缀，只保留JSON内容
                if (line.startsWith("data: ")) {
                    line = line.substring(6); // "data: "的长度是6
                }
                res.write((line + "\n").getBytes(StandardCharsets.UTF_8));
                res.flush();
            }
        }
        catch (IOException e) {
            log.error("Error processing stream", e);
            // 发送错误消息给客户端
            NettyResponse.sendErrorResponse(ctx, "Error processing processing stream");
        }
    }

    public void stopChat(ChannelHandlerContext ctx, ChatMessage message) {
        LoginInfo currentUser = ctx.channel().attr(Constant.ATT_USER_INFO).get();
        try {
            if (currentUser != null) {
                CurrentUserHolder.setLoginInfo(currentUser);
            }
            StopChatDto stopChatDto = new StopChatDto();
            stopChatDto.setAgentId(message.getAgentId());
            stopChatDto.setAgentCode(message.getAgentCode());
            stopChatDto.setSessionId(message.getSessionId());
            stopChatDto.setMessageId(message.getMessageId());
            stopChatDto.setClientRequestId(message.getClientRequestId());
            fillStopChatFromRunningInfo(stopChatDto);
            assistantChatApplicationService.stopChat(stopChatDto);

            JSONObject ack = new JSONObject();
            ack.put("type", "STOP_CHAT_ACK");
            ack.put("clientRequestId", message.getClientRequestId());
            ack.put("sessionId", message.getSessionId() == null ? null : String.valueOf(message.getSessionId()));
            ack.put("messageId", message.getMessageId());
            ctx.writeAndFlush(new io.netty.handler.codec.http.websocketx.TextWebSocketFrame(ack.toJSONString()));
        }
        catch (Exception e) {
            log.error("Error stopping chat", e);
            NettyResponse.sendErrorResponse(ctx, "Error stopping chat");
        }
        finally {
            CurrentUserHolder.clearLoginInfo();
        }
    }

    private void fillStopChatFromRunningInfo(StopChatDto stopChatDto) {
        if (stopChatDto == null || stopChatDto.getSessionId() == null) {
            return;
        }
        RunningChatInfo runningInfo = runningOutputStreamRegistry.getRunning(stopChatDto.getSessionId());
        if (!Boolean.TRUE.equals(runningInfo.getRunning())) {
            return;
        }
        if (stopChatDto.getMessageId() == null) {
            stopChatDto.setMessageId(runningInfo.getModelAnswerMessageId());
        }
        if (stopChatDto.getAgentId() == null) {
            stopChatDto.setAgentId(runningInfo.getAgentId());
        }
        if (stopChatDto.getAgentCode() == null) {
            stopChatDto.setAgentCode(runningInfo.getAgentCode());
        }
        if (stopChatDto.getClientRequestId() == null) {
            stopChatDto.setClientRequestId(runningInfo.getClientRequestId());
        }
    }
}
