package com.iwhalecloud.byai.gateway.channels.service.feishu.event;

import java.io.IOException;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import jakarta.annotation.PreDestroy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.channels.enums.AssistantAccessChannel;
import com.iwhalecloud.byai.gateway.channels.enums.ChannelType;
import com.iwhalecloud.byai.gateway.channels.enums.ChatChannelExtensionKeys;
import com.iwhalecloud.byai.gateway.channels.service.ChannelService;
import com.iwhalecloud.byai.gateway.channels.service.ChannelServiceFactory;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuReplyDispatcher;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuSessionService;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuTokenService;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuUserService;
import com.iwhalecloud.byai.gateway.channels.service.feishu.config.FeishuStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuMsgType;
import com.iwhalecloud.byai.gateway.channels.service.feishu.support.FeishuBufferedOutputStream;
import com.iwhalecloud.byai.gateway.channels.service.feishu.support.FeishuCallbackMessageParser;
import com.iwhalecloud.byai.gateway.channels.service.feishu.support.FeishuStreamingOutputStream;
import com.iwhalecloud.byai.manager.qo.index.MyAuthEmployQo;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import org.apache.commons.collections.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 飞书机器人事件处理器。
 *
 * <p>Controller 收到飞书回调后会立即调用本类分发。
 * 非耗时校验在同步阶段完成，真正调用数字员工聊天放入线程池，避免飞书开放平台回调超时。</p>
 */
@Service
public class FeishuBotEventHandler {

    private static final Logger logger = LoggerFactory.getLogger(FeishuBotEventHandler.class);
    private static final String MESSAGE_RECEIVE_EVENT = "im.message.receive_v1";
    private static final String DEFAULT_FALLBACK_REPLY = "抱歉，遇到了点问题，请稍后再试";
    private static final String UNSUPPORTED_MESSAGE_REPLY = "暂不支持该类型消息";
    private static final String THINKING_REPLY = "正在思考...";
    private static final String MESSAGE_DEDUP_KEY_PREFIX = "feishu:event:msg:";
    private static final long MESSAGE_DEDUP_TTL_SECONDS = 30 * 60L;

    private final ExecutorService messageExecutor = new ThreadPoolExecutor(
            8,
            32,
            60L,
            TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(512),
            new MessageThreadFactory(),
            new ThreadPoolExecutor.CallerRunsPolicy()
    );

    private final ObjectMapper objectMapper;
    private final FeishuCallbackMessageParser feishuCallbackMessageParser;
    private final FeishuUserService feishuUserService;
    private final FeishuTokenService feishuTokenService;
    private final FeishuReplyDispatcher feishuReplyDispatcher;
    private final FeishuSessionService feishuSessionService;
    private final IndexService indexService;
    private final FeishuStreamProperties streamProperties;

    public FeishuBotEventHandler(
            ObjectMapper objectMapper,
            FeishuCallbackMessageParser feishuCallbackMessageParser,
            FeishuUserService feishuUserService,
            FeishuTokenService feishuTokenService,
            FeishuReplyDispatcher feishuReplyDispatcher,
            FeishuSessionService feishuSessionService,
            IndexService indexService,
            FeishuStreamProperties streamProperties
    ) {
        this.objectMapper = objectMapper;
        this.feishuCallbackMessageParser = feishuCallbackMessageParser;
        this.feishuUserService = feishuUserService;
        this.feishuTokenService = feishuTokenService;
        this.feishuReplyDispatcher = feishuReplyDispatcher;
        this.feishuSessionService = feishuSessionService;
        this.indexService = indexService;
        this.streamProperties = streamProperties;
    }

    public void handleEvent(JsonNode root) {
        if (!isStreamEnabled()) {
            logger.info("Feishu bot is disabled. Set channel.stream.enabled=true to enable it.");
            return;
        }
        String eventType = root.path("header").path("event_type").asText("");
        if (!MESSAGE_RECEIVE_EVENT.equals(eventType)) {
            logger.debug("Ignore unsupported Feishu event. eventType={}", eventType);
            return;
        }

        FeishuCallbackMessage message = feishuCallbackMessageParser.parse(root);
        logger.info("Received Feishu bot message. eventId={}, messageId={}, appId={}, msgType={}, chatType={}, senderType={}, content={}",
                message.getEventId(), message.getMessageId(), message.getAppId(), message.getMessageType(),
                message.getChatType(), message.getSenderType(), message.getTextContent());

        if (StringUtils.hasText(message.getSenderType()) && !"user".equalsIgnoreCase(message.getSenderType())) {
            logger.info("Skip Feishu message because sender is not user. eventId={}, messageId={}, senderType={}",
                    message.getEventId(), message.getMessageId(), message.getSenderType());
            return;
        }

        if (isGroupMessageWithoutBotMention(message)) {
            logger.info("Skip Feishu group message because bot is not mentioned. eventId={}, messageId={}, chatId={}",
                    message.getEventId(), message.getMessageId(), message.getChatId());
            return;
        }

        if (isDuplicateMessage(resolveDedupId(message))) {
            logger.info("Skip duplicate Feishu bot message. eventId={}, messageId={}",
                    message.getEventId(), message.getMessageId());
            return;
        }

        if (!isSupportedMessageType(message.getMessageType())) {
            replyTextQuietly(message, UNSUPPORTED_MESSAGE_REPLY);
            return;
        }

        messageExecutor.execute(() -> handleMessageAsync(message));
    }

    private boolean isGroupMessageWithoutBotMention(FeishuCallbackMessage message) {
        return message != null
                && "group".equalsIgnoreCase(message.getChatType())
                && !message.isMentionedBot();
    }

    private void handleMessageAsync(FeishuCallbackMessage message) {
        try {
            LoginInfo userInfo = feishuUserService.resolveLoginInfo(message);
            if (userInfo == null) {
                return;
            }

            AuthDigitEmployVo digitEmployVo = findAuthorizedDigitEmploy(userInfo.getUserId(), message.getAppId());
            if (digitEmployVo == null) {
                replyText(message, "对不起，您可能没有数字员工的权限");
                return;
            }

            String sessionExtValue = buildSessionExtValue(message);
            AssistantChatDto assistantChatDto = buildAssistantChatDto(digitEmployVo, sessionExtValue, message);
            replyAssistantMessage(digitEmployVo, assistantChatDto, message);
        } catch (Exception e) {
            logger.error("Failed to reply Feishu bot message. eventId={}, messageId={}, appId={}",
                    message.getEventId(), message.getMessageId(), message.getAppId(), e);
            replyTextQuietly(message, "消息异常：" + e.getMessage());
        } finally {
            CurrentUserHolder.clearLoginInfo();
        }
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

    private AuthDigitEmployVo findAuthorizedDigitEmploy(Long userId, String appId) {
        MyAuthEmployQo myAuthEmployQo = new MyAuthEmployQo();
        myAuthEmployQo.setUserId(userId);
        // 飞书配置以 appId 作为 machineChannel 里的稳定匹配 key。
        myAuthEmployQo.setMachineChannel(appId);

        List<AuthDigitEmployVo> authDigitEmployVos = indexService.selectAuthDigitEmploy(myAuthEmployQo);
        if (CollectionUtils.isEmpty(authDigitEmployVos)) {
            return null;
        }
        return authDigitEmployVos.get(0);
    }

    private String buildSessionExtValue(FeishuCallbackMessage message) {
        if ("group".equalsIgnoreCase(message.getChatType())) {
            return (message.getSenderOpenId() == null ? "" : message.getSenderOpenId())
                    + (message.getChatId() == null ? "" : message.getChatId());
        }
        return message.getChatId();
    }

    private AssistantChatDto buildAssistantChatDto(
            AuthDigitEmployVo digitEmployVo,
            String sessionExtValue,
            FeishuCallbackMessage message
    ) {
        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setAccessTerminal(ChannelType.FEISHU.getCode());
        assistantChatDto.setChatContent(message.getTextContent() == null || message.getTextContent().isBlank()
                ? ""
                : message.getTextContent());
        assistantChatDto.setRelModelId(-1L);
        assistantChatDto.setAgentId(digitEmployVo.getId());
        assistantChatDto.setAgentType(digitEmployVo.getAgentType());
        assistantChatDto.setSessionId(feishuSessionService.resolveSessionId(
                message.getTextContent(),
                sessionExtValue,
                digitEmployVo.getId()
        ));
        assistantChatDto.setResourceList(buildResourceList(digitEmployVo));
        // 不设置 clientRequestId：
        // 当前聊天主链路会把 clientRequestId 识别为 WebSocket 传输标识，随后只发送 Gateway 消息并异步返回。
        // 飞书机器人需要在后台线程里等数字员工生成完答案，再调用飞书「回复消息」接口一次性发回；
        // 因此保持 HTTP_SSE 传输语义，让 channelService.chat(...) 阻塞到本轮答案流结束。

        Map<String, String> channelExt = new HashMap<>();
        channelExt.put(ChatChannelExtensionKeys.CHANNEL_TYPE, AssistantAccessChannel.FEISHU.getTypeCode());
        channelExt.put(ChatChannelExtensionKeys.FEISHU_CHAT_ID, nullToEmpty(message.getChatId()));
        channelExt.put(ChatChannelExtensionKeys.FEISHU_CHAT_TYPE, nullToEmpty(message.getChatType()));
        channelExt.put(ChatChannelExtensionKeys.FEISHU_MESSAGE_ID, nullToEmpty(message.getMessageId()));
        channelExt.put(ChatChannelExtensionKeys.FEISHU_SENDER_OPEN_ID, nullToEmpty(message.getSenderOpenId()));
        channelExt.put(ChatChannelExtensionKeys.FEISHU_SENDER_UNION_ID, nullToEmpty(message.getSenderUnionId()));
        assistantChatDto.setChannelExtension(channelExt);
        assistantChatDto.getExtParams().put("files", Collections.emptyList());
        return assistantChatDto;
    }

    private List<ResourceVo> buildResourceList(AuthDigitEmployVo digitEmployVo) {
        ResourceVo resourceVo = new ResourceVo();
        resourceVo.setResourceId(String.valueOf(digitEmployVo.getId()));
        resourceVo.setResourceName(digitEmployVo.getName());
        resourceVo.setResourceType(AgentMetaEnum.DIG_EMPLOYEE);
        resourceVo.setResourceCode(digitEmployVo.getResourceCode());
        return List.of(resourceVo);
    }

    private void replyAssistantMessage(
            AuthDigitEmployVo digitEmployVo,
            AssistantChatDto assistantChatDto,
            FeishuCallbackMessage message
    ) throws IOException {
        if (!isStreamEnabled()) {
            logger.info("Skip Feishu assistant reply because channel.stream.enabled is false. messageId={}",
                    message.getMessageId());
            return;
        }
        ChannelService channelService = ChannelServiceFactory.getService(ChannelType.FEISHU.getCode());
        if (!channelService.validateRequest(assistantChatDto)) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.chat.request.invalid"));
        }
        if (!StringUtils.hasText(message.getAppId())) {
            replyText(message, "飞书应用 appId 未配置，暂无法回复。");
            return;
        }

        String tenantAccessToken = feishuTokenService.getTenantAccessToken(message.getAppId());
        String cardTitle = digitEmployVo == null ? "" : digitEmployVo.getName();
        String streamMessageId = feishuReplyDispatcher.replyCardMessage(
                tenantAccessToken,
                message.getMessageId(),
                cardTitle,
                THINKING_REPLY
        );
        FeishuBufferedOutputStream outputStream = StringUtils.hasText(streamMessageId)
                ? new FeishuStreamingOutputStream(
                        objectMapper,
                        feishuReplyDispatcher,
                        tenantAccessToken,
                        streamMessageId,
                        cardTitle,
                        isShowReasoning()
                )
                : new FeishuBufferedOutputStream(objectMapper, isShowReasoning());

        channelService.chat(assistantChatDto, outputStream);
        String replyContent = outputStream.getDisplayContent();
        logger.info("Feishu assistant reply generated. agentId={}, messageId={}, contentLength={}",
                digitEmployVo.getId(), message.getMessageId(), replyContent == null ? 0 : replyContent.length());
        if (outputStream instanceof FeishuStreamingOutputStream streamingOutputStream) {
            streamingOutputStream.finish();
            if (streamingOutputStream.hasUpdateFailed()) {
                replyText(message, StringUtils.hasText(replyContent) ? replyContent : DEFAULT_FALLBACK_REPLY);
            }
            return;
        }

        replyText(message, StringUtils.hasText(replyContent) ? replyContent : DEFAULT_FALLBACK_REPLY);
    }

    private boolean isStreamEnabled() {
        return streamProperties != null && streamProperties.isEnabled();
    }

    private boolean isShowReasoning() {
        return streamProperties != null && streamProperties.isShowReasoning();
    }

    private void replyText(FeishuCallbackMessage message, String content) throws IOException {
        String tenantAccessToken = feishuTokenService.getTenantAccessToken(message.getAppId());
        feishuReplyDispatcher.replyTextMessage(tenantAccessToken, message.getMessageId(), content);
    }

    private void replyTextQuietly(FeishuCallbackMessage message, String content) {
        try {
            replyText(message, content);
        } catch (Exception e) {
            logger.error("Failed to send Feishu text reply. eventId={}, messageId={}",
                    message.getEventId(), message.getMessageId(), e);
        }
    }

    private boolean isSupportedMessageType(String msgType) {
        return FeishuMsgType.TEXT.matches(msgType);
    }

    private String resolveDedupId(FeishuCallbackMessage message) {
        if (StringUtils.hasText(message.getMessageId())) {
            return message.getMessageId();
        }
        return message.getEventId();
    }

    private boolean isDuplicateMessage(String dedupId) {
        if (!StringUtils.hasText(dedupId)) {
            return false;
        }
        Boolean firstConsume = RedisUtil.setIfAbsent(
                MESSAGE_DEDUP_KEY_PREFIX + dedupId,
                "1",
                MESSAGE_DEDUP_TTL_SECONDS
        );
        return Boolean.FALSE.equals(firstConsume);
    }

    private String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private static class MessageThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger(1);

        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "feishu-bot-msg-" + counter.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        }
    }
}
