package com.iwhalecloud.byai.gateway.channels.service.wecom.stream;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomReplyDispatcher;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomMessageParser;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.channels.enums.AssistantAccessChannel;
import com.iwhalecloud.byai.gateway.channels.enums.ChannelType;
import com.iwhalecloud.byai.gateway.channels.enums.ChatChannelExtensionKeys;
import com.iwhalecloud.byai.gateway.channels.service.ChannelService;
import com.iwhalecloud.byai.gateway.channels.service.ChannelServiceFactory;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomChatType;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomEventMessage;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomMsgType;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.config.WecomStreamProperties;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.manager.qo.index.MyAuthEmployQo;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import jakarta.annotation.PreDestroy;
import org.apache.commons.collections.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Central WeCom callback handler, mirroring {@code DingtalkBotListener}. It is a
 * shared singleton holding the stateless services; the per-connection
 * {@link WecomReplyDispatcher} is passed in by the registry (Task 9) so replies
 * go back on the socket that received the callback.
 *
 * <p>Main chain: onCallback → dedup → bounded executor → resolve user
 * (sets {@link CurrentUserHolder}) → authorize digital employee → build chat dto
 * → download media → {@code channelService.chat(dto, WecomStreamOutputStream)} →
 * finish. {@link CurrentUserHolder} is cleared in a finally on the worker thread.
 *
 * <p>Listener-level replies (plan §Task 5 / codex): unsupported msgtype →
 * "暂不支持"; async failure → text fallback via the callback req_id; streaming
 * failure → fallback text.
 */
@Service
public class WecomMessageListener {

    private static final Logger logger = LoggerFactory.getLogger(WecomMessageListener.class);
    private static final String NO_ACCOUNT_REPLY = "未找到匹配的系统用户，请联系管理员绑定企业微信账号后再试。";
    private static final String NO_AUTH_REPLY = "对不起，您可能没有该数字员工的权限。";
    private static final String UNSUPPORTED_REPLY = "暂不支持该类型消息";
    private static final String FALLBACK_REPLY = "抱歉，遇到了点问题，请稍后再试。";
    private static final String BUSY_REPLY = "当前咨询人数较多，请稍后再试。";

    private final ObjectMapper objectMapper;
    private final WecomMessageParser messageParser;
    private final WecomDedupService dedupService;
    private final WecomUserService userService;
    private final WecomSessionService sessionService;
    private final WecomFileService fileService;
    private final WecomEventService eventService;
    private final WecomStreamProperties streamProperties;

    @Autowired
    private IndexService indexService;

    private final ExecutorService messageExecutor = new ThreadPoolExecutor(
            8, 32, 60L, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(512),
            new MessageThreadFactory(),
            // AbortPolicy (NOT CallerRunsPolicy): under saturation the submit
            // must be rejected so chat() never runs on the WebSocket callback
            // thread — running it there would starve ACK/heartbeat processing.
            // The caller catches the rejection and sends a busy reply.
            new ThreadPoolExecutor.AbortPolicy());

    public WecomMessageListener(ObjectMapper objectMapper,
                                WecomMessageParser messageParser,
                                WecomDedupService dedupService,
                                WecomUserService userService,
                                WecomSessionService sessionService,
                                WecomFileService fileService,
                                WecomEventService eventService,
                                WecomStreamProperties streamProperties) {
        this.objectMapper = objectMapper;
        this.messageParser = messageParser;
        this.dedupService = dedupService;
        this.userService = userService;
        this.sessionService = sessionService;
        this.fileService = fileService;
        this.eventService = eventService;
        this.streamProperties = streamProperties;
    }

    /** Route a message callback frame; dispatcher is bound to the receiving connection. */
    public void onMessageCallback(WecomWsFrame frame, WecomReplyDispatcher dispatcher) {
        WecomCallbackMessage message = messageParser.parseCallback(frame);
        if (dedupService.isDuplicateMessage(message.getMsgId())) {
            logger.info("Skip duplicate WeCom message. msgId={}", message.getMsgId());
            return;
        }
        if (!isSupported(message.getMsgType())) {
            dispatcher.replyText(message.getReqId(), UNSUPPORTED_REPLY);
            return;
        }
        try {
            messageExecutor.execute(() -> handleMessageAsync(message, dispatcher));
        } catch (RejectedExecutionException e) {
            // Pool saturated: AbortPolicy rejected the task rather than running
            // it on the WebSocket callback thread (which would starve ACK/
            // heartbeat processing). Tell the user we are busy instead of
            // silently dropping the message.
            logger.warn("WeCom message executor saturated, sending busy reply. msgId={}", message.getMsgId());
            dispatcher.replyText(message.getReqId(), BUSY_REPLY);
        }
    }

    /** Route an event callback frame (enter_chat welcome / card update / feedback). */
    public void onEventCallback(WecomWsFrame frame, WecomReplyDispatcher dispatcher) {
        WecomEventMessage event = messageParser.parseEvent(frame);
        eventService.handleEvent(event, dispatcher);
    }

    private void handleMessageAsync(WecomCallbackMessage message, WecomReplyDispatcher dispatcher) {
        String reqId = message.getReqId();
        try {
            LoginInfo loginInfo = userService.resolveLoginInfo(message.getFromUserId(), message.getAibotId());
            if (loginInfo == null) {
                dispatcher.replyText(reqId, NO_ACCOUNT_REPLY);
                return;
            }

            AuthDigitEmployVo digitEmploy = findAuthorizedDigitEmploy(loginInfo.getUserId(), message.getAibotId());
            if (digitEmploy == null) {
                dispatcher.replyText(reqId, NO_AUTH_REPLY);
                return;
            }

            AssistantChatDto dto = buildAssistantChatDto(digitEmploy, message);

            List<MessageFileDto> files = fileService.downloadMessageFiles(message, dto);
            if (CollectionUtils.isNotEmpty(files)) {
                dto.setFiles(files);
                if (dto.getChatContent() == null || dto.getChatContent().isBlank()) {
                    dto.setChatContent(" ");
                }
            }

            ChannelService channelService = ChannelServiceFactory.getService(ChannelType.WECOM.getCode());
            if (!channelService.validateRequest(dto)) {
                dispatcher.replyText(reqId, FALLBACK_REPLY);
                return;
            }

            WecomStreamOutputStream out = new WecomStreamOutputStream(
                    objectMapper, dispatcher, reqId, streamProperties != null && streamProperties.isShowReasoning());
            try {
                logger.info("WeCom chat start. msgId={}, reqId={}, sessionId={}, agentId={}",
                        message.getMsgId(), reqId, dto.getSessionId(), dto.getAgentId());
                channelService.chat(dto, out);
                // Gateway-mode chat returns after dispatching the request; the
                // actual answerDelta/appStreamResponse arrives asynchronously.
                // Wait for appStreamResponse to finalize the WeCom stream.
                // The timeout is an idle timeout: every outputStream.write(...)
                // from chat resets the 60s window.
                logger.info("WeCom chat returned, waiting final stream event. msgId={}, reqId={}, contentLength={}, content={}",
                        message.getMsgId(), reqId, out.getAccumulatedContent().length(), out.getAccumulatedContent());
                boolean finalOk = awaitStreamCompletion(out);
                logger.info("WeCom final stream frame completed. msgId={}, reqId={}, finalOk={}, streamingFailed={}",
                        message.getMsgId(), reqId, finalOk, out.hasStreamingFailed());
                if (!finalOk || out.hasStreamingFailed()) {
                    dispatcher.replyText(reqId, FALLBACK_REPLY);
                }
            } catch (Exception e) {
                logger.error("WeCom chat failed. msgId={}", message.getMsgId(), e);
                logger.info("WeCom chat failed, sending final stream frame before fallback. msgId={}, reqId={}, contentLength={}, content={}",
                        message.getMsgId(), reqId, out.getAccumulatedContent().length(), out.getAccumulatedContent());
                boolean finalOk = awaitFinalFrame(out.finish());
                logger.info("WeCom final stream frame after chat failure completed. msgId={}, reqId={}, finalOk={}, streamingFailed={}",
                        message.getMsgId(), reqId, finalOk, out.hasStreamingFailed());
                dispatcher.replyText(reqId, FALLBACK_REPLY);
            }
        } catch (Exception e) {
            logger.error("WeCom message handling failed. msgId={}", message.getMsgId(), e);
            dispatcher.replyText(reqId, FALLBACK_REPLY);
        } finally {
            // Always clear the ThreadLocal login so the pooled thread does not
            // leak this user's context into the next message.
            CurrentUserHolder.clearLoginInfo();
        }
    }

    /**
     * Await the final stream frame's ACK so a late error/timeout is observed.
     * Returns true if the final frame was ACKed ok, false on error/timeout.
     * Bounded wait (6s) so a dead connection cannot hang the worker thread.
     */
    private boolean awaitFinalFrame(java.util.concurrent.CompletableFuture<?> finalFrame) {
        if (finalFrame == null) {
            return true;
        }
        try {
            finalFrame.get(6, java.util.concurrent.TimeUnit.SECONDS);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean awaitStreamCompletion(WecomStreamOutputStream out) {
        try {
            out.awaitCompletionAfterIdle(60, java.util.concurrent.TimeUnit.SECONDS);
            return true;
        } catch (java.util.concurrent.TimeoutException e) {
            logger.warn("Wait WeCom appStreamResponse idle timeout, finalize current stream content.");
            return awaitFinalFrame(out.finish());
        } catch (Exception e) {
            return false;
        }
    }

    private AuthDigitEmployVo findAuthorizedDigitEmploy(Long userId, String botId) {
        MyAuthEmployQo qo = new MyAuthEmployQo();
        qo.setUserId(userId);
        qo.setMachineChannel(botId);
        List<AuthDigitEmployVo> authed = indexService.selectAuthDigitEmploy(qo);
        if (CollectionUtils.isEmpty(authed)) {
            return null;
        }
        return authed.get(0);
    }

    private AssistantChatDto buildAssistantChatDto(AuthDigitEmployVo digitEmploy, WecomCallbackMessage message) {
        boolean group = WecomChatType.GROUP.matches(message.getChatType());
        String userText = message.getTextContent();

        AssistantChatDto dto = new AssistantChatDto();
        dto.setAccessTerminal(ChannelType.WECOM.getCode());
        dto.setChatContent(userText == null ? "" : userText);
        dto.setRelModelId(-1L);
        dto.setAgentId(digitEmploy.getId());
        dto.setAgentType(digitEmploy.getAgentType());

        String sessionKey = sessionService.buildSessionKey(
                message.getAibotId(), message.getFromUserId(), message.getChatId(), group);
        dto.setSessionId(sessionService.resolveSessionId(userText, sessionKey, digitEmploy.getId()));
        dto.setResourceList(buildResourceList(digitEmploy));
        dto.setClientRequestId(AssistantChatService.getClientRequestId());

        Map<String, String> ext = new HashMap<>();
        ext.put(ChatChannelExtensionKeys.CHANNEL_TYPE, AssistantAccessChannel.WECOM.getTypeCode());
        ext.put(ChatChannelExtensionKeys.WECOM_BOT_ID, nz(message.getAibotId()));
        ext.put(ChatChannelExtensionKeys.WECOM_CHAT_ID, nz(message.getChatId()));
        ext.put(ChatChannelExtensionKeys.WECOM_CHAT_TYPE, nz(message.getChatType()));
        ext.put(ChatChannelExtensionKeys.WECOM_USER_ID, nz(message.getFromUserId()));
        ext.put(ChatChannelExtensionKeys.WECOM_MESSAGE_ID, nz(message.getMsgId()));
        dto.setChannelExtension(ext);
        return dto;
    }

    private List<ResourceVo> buildResourceList(AuthDigitEmployVo digitEmploy) {
        ResourceVo resourceVo = new ResourceVo();
        resourceVo.setResourceId(String.valueOf(digitEmploy.getId()));
        resourceVo.setResourceName(digitEmploy.getName());
        resourceVo.setResourceType(AgentMetaEnum.DIG_EMPLOYEE);
        resourceVo.setResourceCode(digitEmploy.getResourceCode());
        return List.of(resourceVo);
    }

    private boolean isSupported(String msgType) {
        WecomMsgType type = WecomMsgType.fromCode(msgType);
        return type == WecomMsgType.TEXT
                || type == WecomMsgType.VOICE
                || type == WecomMsgType.IMAGE
                || type == WecomMsgType.FILE
                || type == WecomMsgType.MIXED;
    }

    private String nz(String v) {
        return v == null ? "" : v;
    }

    @PreDestroy
    public void shutdown() {
        messageExecutor.shutdown();
        try {
            if (!messageExecutor.awaitTermination(10, TimeUnit.SECONDS)) {
                messageExecutor.shutdownNow();
            }
        } catch (InterruptedException e) {
            messageExecutor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    private static final class MessageThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger(1);

        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "wecom-bot-msg-" + counter.getAndIncrement());
            t.setDaemon(true);
            return t;
        }
    }
}
