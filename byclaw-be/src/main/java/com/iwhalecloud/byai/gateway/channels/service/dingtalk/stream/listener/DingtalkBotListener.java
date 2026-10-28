package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicBoolean;

import jakarta.annotation.PreDestroy;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.channels.enums.AssistantAccessChannel;
import com.iwhalecloud.byai.gateway.channels.enums.ChannelType;
import com.iwhalecloud.byai.gateway.channels.enums.ChatChannelExtensionKeys;
import com.iwhalecloud.byai.gateway.channels.service.ChannelService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.DingtalkChannelService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkFileDownloadService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkReplyDispatcher;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkSessionService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkUserService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.cards.DingtalkCardService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.cards.DingtalkCardStreamSession;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.cards.DingtalkCardStreamingOutputStream;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkMsgType;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.support.DingtalkCallbackMessageParser;
import com.iwhalecloud.byai.manager.qo.index.MyAuthEmployQo;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import org.apache.commons.collections.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import com.dingtalk.open.app.api.callback.OpenDingTalkCallbackListener;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.i18n.LocaleContext;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.util.StringUtils;

@Service
public class DingtalkBotListener implements OpenDingTalkCallbackListener<Map<String, Object>, Map<String, Object>> {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkBotListener.class);
    private static final String DEFAULT_FALLBACK_REPLY_KEY = "channel.error.retry";
    private static final String MESSAGE_DEDUP_KEY_PREFIX = "dingtalk:stream:msg:";
    private static final long MESSAGE_DEDUP_TTL_SECONDS = 30 * 60L;

    private static final String UNSUPPORTED_MESSAGE_REPLY_KEY = "channel.message.unsupported";
    private static final String GROUP_UNSUPPORTED_AUDIO_REPLY = "群聊暂不支持该类型消息";

    private final ObjectMapper objectMapper;
    private final DingtalkUserService dingtalkUserService;
    private final DingtalkFileDownloadService dingtalkFileDownloadService;
    private final DingtalkReplyDispatcher dingtalkReplyDispatcher;
    private final DingtalkCardService dingtalkCardService;
    private final DingtalkCallbackMessageParser dingtalkCallbackMessageParser;
    private final DingtalkSessionService dingtalkSessionService;
    private final DingtalkStreamProperties streamProperties;
    private final ChannelService channelService;
    private final ThreadPoolExecutor preparationExecutor;
    private final ThreadPoolExecutor chatExecutor;

    @Autowired
    private IndexService indexService;

    public DingtalkBotListener(
            ObjectMapper objectMapper,
            DingtalkUserService dingtalkUserService,
            DingtalkFileDownloadService dingtalkFileDownloadService,
            DingtalkReplyDispatcher dingtalkReplyDispatcher,
            DingtalkCardService dingtalkCardService,
            DingtalkCallbackMessageParser dingtalkCallbackMessageParser,
            DingtalkSessionService dingtalkSessionService,
            DingtalkStreamProperties streamProperties,
            @Lazy DingtalkChannelService channelService
    ) {
        this.objectMapper = objectMapper;
        this.dingtalkUserService = dingtalkUserService;
        this.dingtalkFileDownloadService = dingtalkFileDownloadService;
        this.dingtalkReplyDispatcher = dingtalkReplyDispatcher;
        this.dingtalkCardService = dingtalkCardService;
        this.dingtalkCallbackMessageParser = dingtalkCallbackMessageParser;
        this.dingtalkSessionService = dingtalkSessionService;
        this.streamProperties = streamProperties;
        this.channelService = channelService;
        DingtalkStreamProperties.Dispatch dispatch = streamProperties.getDispatch();
        this.preparationExecutor = createExecutor(dispatch.getPreparationWorkers(),
            dispatch.getPreparationQueueCapacity(), "dingtalk-bot-prepare-");
        this.chatExecutor = createExecutor(dispatch.getChatWorkers(), dispatch.getChatQueueCapacity(), "dingtalk-bot-chat-");
    }

    @Override
    public Map<String, Object> execute(Map<String, Object> callbackData) {
        long receivedAt = System.nanoTime();
        DingtalkCallbackMessage DDMessage = dingtalkCallbackMessageParser.parse(callbackData);
        String msgId = DDMessage.getMsgId();
        String sessionWebhook = DDMessage.getSessionWebhook();
        String conversationType = DDMessage.getConversationType();
        String conversationId = DDMessage.getConversationId();
        String senderStaffId = DDMessage.getSenderStaffId();
        String msgtype = DDMessage.getMsgtype();
        MessageTiming timing = new MessageTiming(msgId, UUID.randomUUID().toString(), receivedAt,
            LocaleContextHolder.getLocaleContext());

        logStage(timing, "received", receivedAt, "ok");

        if (sessionWebhook == null || sessionWebhook.isBlank()) {
            logger.warn("Skip replying because sessionWebhook is empty. msgId={}", msgId);
            return new HashMap<>();
        }

        if (isDuplicateMessage(msgId)) {
            logger.info("Skip duplicate DingTalk bot message. msgId={}, conversationId={}, senderStaffId={}",
                    msgId, conversationId, senderStaffId);
            return new HashMap<>();
        }

        if (!isSupportedMessageType(msgtype)) {
            try {
                dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, I18nUtil.get(UNSUPPORTED_MESSAGE_REPLY_KEY));
            } catch (IOException e) {
                logger.error("Failed to reply unsupported DingTalk message type. msgId={}, msgtype={}", msgId, msgtype, e);
            }
            return new HashMap<>();
        }

        if ("2".equals(conversationType) && (
            DingtalkMsgType.AUDIO.matches(msgtype) ||
            DingtalkMsgType.FILE.matches(msgtype) ||
            DingtalkMsgType.VIDEO.matches(msgtype) ||
            DingtalkMsgType.INTERACTIVE_CARD.matches(msgtype)
        )) {
            try {
                dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, GROUP_UNSUPPORTED_AUDIO_REPLY);
            } catch (IOException e) {
                logger.error("Failed to reply group unsupported audio message. msgId={}", msgId, e);
            }
            return new HashMap<>();
        }

        try {
            preparationExecutor.execute(() -> prepareMessage(DDMessage, timing));
        } catch (RejectedExecutionException e) {
            logStage(timing, "preparation_rejected", receivedAt, "busy");
            notifyFailure(DDMessage, null, "channel.error.busy");
        }

        return new HashMap<>();
    }

    private void prepareMessage(DingtalkCallbackMessage DDMessage, MessageTiming timing) {
        String msgId = DDMessage.getMsgId();
        String sessionWebhook = DDMessage.getSessionWebhook();
        String robotCode = DDMessage.getRobotCode();
        String senderStaffId = DDMessage.getSenderStaffId();

        DingtalkCardStreamSession cardSession = null;
        setThreadContext(timing, null);
        try {
            logStage(timing, "preparation_dequeued", timing.receivedAt(), "ok");
            long started = System.nanoTime();
            LoginInfo userInfo = dingtalkUserService.resolveLoginInfo(DDMessage);
            logStage(timing, "user_resolved", started, "ok");
            if (userInfo == null) {
                dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, I18nUtil.get("channel.account.notFound"));
                return;
            }

            started = System.nanoTime();
            AuthDigitEmployVo digitEmployVo = findAuthorizedDigitEmploy(userInfo.getUserId(), robotCode);
            logStage(timing, "authorized", started, "ok");
            if (digitEmployVo == null) {
                dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, "对不起，您可能没有数字员工的权限");
                return;
            }

            String sessionExtValue = buildSessionExtValue(DDMessage);
            started = System.nanoTime();
            AssistantChatDto assistantChatDto = buildAssistantChatDto(
                digitEmployVo, sessionExtValue, DDMessage
            );
            assistantChatDto.setClientRequestId(timing.requestId());
            logStage(timing, "session_resolved", started, "ok");
            if (!channelService.validateRequest(assistantChatDto)) {
                throw new BdpRuntimeException(I18nUtil.get("assistant.chat.request.invalid"));
            }
            started = System.nanoTime();
            cardSession = dingtalkCardService.createAssistantReplyCardSession(senderStaffId, robotCode,
                DDMessage.getConversationType(), DDMessage.getConversationId(), digitEmployVo.getName());
            logStage(timing, "first_card", started, "ok");
            DingtalkCardStreamSession preparedCard = cardSession;
            long queuedAt = System.nanoTime();
            try {
                chatExecutor.execute(() -> processMessage(DDMessage, assistantChatDto, userInfo,
                    preparedCard, timing, queuedAt));
            } catch (RejectedExecutionException e) {
                logStage(timing, "chat_rejected", queuedAt, "busy");
                notifyFailure(DDMessage, cardSession, "channel.error.busy");
            }
        } catch (Exception e) {
            logger.error("Failed to reply DingTalk bot message. msgId={}, senderStaffId={}, robotCode={}",
                    msgId, senderStaffId, robotCode, e);
            logStage(timing, "preparation_failed", timing.receivedAt(), "failed");
            notifyFailure(DDMessage, cardSession, DEFAULT_FALLBACK_REPLY_KEY);
        } finally {
            clearThreadContext();
        }
    }

    private void processMessage(DingtalkCallbackMessage message, AssistantChatDto chatDto, LoginInfo userInfo,
        DingtalkCardStreamSession cardSession, MessageTiming timing, long queuedAt) {
        setThreadContext(timing, userInfo);
        try {
            logStage(timing, "chat_dequeued", queuedAt, "ok");
            long started = System.nanoTime();
            List<MessageFileDto> files = dingtalkFileDownloadService.downloadMessageFiles(message, chatDto);
            if (CollectionUtils.isNotEmpty(files)) {
                chatDto.setFiles(files);
                chatDto.getExtParams().put("files", buildExtParamFiles(files, userInfo));
                if (!StringUtils.hasText(chatDto.getChatContent())) {
                    chatDto.setChatContent(" ");
                }
            }
            logStage(timing, "files_ready", started, "ok");
            replyAssistantCardStreamingMessage(message.getSessionWebhook(), chatDto, cardSession);
            logStage(timing, "completed", timing.receivedAt(), "ok");
        } catch (Exception e) {
            logger.error("DingTalk chat failed. msgId={}, requestId={}", timing.msgId(), timing.requestId(), e);
            logStage(timing, "chat_failed", timing.receivedAt(), "failed");
            notifyFailure(message, cardSession, DEFAULT_FALLBACK_REPLY_KEY);
        } finally {
            clearThreadContext();
        }
    }

    private void notifyFailure(DingtalkCallbackMessage message, DingtalkCardStreamSession cardSession, String key) {
        String content = I18nUtil.get(key);
        if (cardSession != null && !cardSession.isFinalized()) {
            try {
                dingtalkCardService.streamingUpdateAssistantReply(cardSession, content, true);
                return;
            } catch (Exception e) {
                logger.warn("DingTalk failure card update failed. msgId={}", message.getMsgId(), e);
            }
        }
        try {
            dingtalkReplyDispatcher.sendTextMessage(message.getSessionWebhook(), content);
        } catch (Exception e) {
            logger.error("DingTalk failure text delivery failed. msgId={}", message.getMsgId(), e);
        }
    }

    @PreDestroy
    public void shutdown() {
        shutdownExecutor(preparationExecutor);
        shutdownExecutor(chatExecutor);
    }

    private void shutdownExecutor(ThreadPoolExecutor executor) {
        executor.shutdown();
        try {
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    private AuthDigitEmployVo findAuthorizedDigitEmploy(Long userId, String robotCode) {
        MyAuthEmployQo myAuthEmployQo = new MyAuthEmployQo();
        myAuthEmployQo.setUserId(userId);
        myAuthEmployQo.setMachineChannel(robotCode);

        List<AuthDigitEmployVo> authDigitEmployVos = indexService.selectAuthDigitEmploy(myAuthEmployQo);
        if (CollectionUtils.isEmpty(authDigitEmployVos)) {
            return null;
        }
        return authDigitEmployVos.get(0);
    }

    private String buildSessionExtValue(DingtalkCallbackMessage DDMessage) {
        String conversationType = DDMessage.getConversationType();
        String senderStaffId = DDMessage.getSenderStaffId();
        String conversationId = DDMessage.getConversationId();

        if ("2".equals(conversationType)) {
            return (senderStaffId == null ? "" : senderStaffId) + (conversationId == null ? "" : conversationId);
        }
        return conversationId;
    }

    private boolean isDuplicateMessage(String msgId) {
        if (msgId == null || msgId.isBlank()) {
            return false;
        }
        Boolean firstConsume = RedisUtil.setIfAbsent(
                MESSAGE_DEDUP_KEY_PREFIX + msgId,
                "1",
                MESSAGE_DEDUP_TTL_SECONDS
        );
        return Boolean.FALSE.equals(firstConsume);
    }

    private void replyAssistantCardStreamingMessage(
            String sessionWebhook,
            AssistantChatDto assistantChatDto,
            DingtalkCardStreamSession cardSession
    ) throws IOException {
        long chatStarted = System.nanoTime();
        AtomicBoolean firstContent = new AtomicBoolean();
        DingtalkCardStreamingOutputStream outputStream =
                new DingtalkCardStreamingOutputStream(objectMapper, dingtalkCardService, cardSession,
                        content -> {
                            if (StringUtils.hasText(content) && firstContent.compareAndSet(false, true)) {
                                logger.info("dingtalk_chain requestId={} stage=first_content durationMs={}",
                                    assistantChatDto.getClientRequestId(),
                                    TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - chatStarted));
                            }
                        }, CurrentUserHolder.getCurrentUserCode(), streamProperties.isShowReasoning());
        try {
            channelService.chat(assistantChatDto, outputStream);
            // Some transports complete asynchronously; appStreamResponse or idle timeout owns finalization.
            boolean finalOk = awaitStreamCompletion(outputStream);
            if (!finalOk || outputStream.hasStreamingFailed()) {
                dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, I18nUtil.get(DEFAULT_FALLBACK_REPLY_KEY));
            }
        } catch (Exception e) {
            try {
                outputStream.finish();
            } catch (Exception finishEx) {
                logger.warn("Finalize DingTalk card failed after chat exception. outTrackId={}",
                        cardSession.getOutTrackId(), finishEx);
            }

            throw new RuntimeException(e);
        }
    }

    static boolean awaitStreamCompletion(DingtalkCardStreamingOutputStream outputStream) {
        try {
            outputStream.awaitCompletionAfterIdle(60, TimeUnit.SECONDS);
            return true;
        } catch (java.util.concurrent.TimeoutException e) {
            logger.warn("Wait DingTalk appStreamResponse idle timeout, finalize current card content.");
            try {
                outputStream.finish();
                return !outputStream.hasStreamingFailed();
            } catch (Exception finishException) {
                logger.warn("Finalize DingTalk card after idle timeout failed.", finishException);
                return false;
            }
        } catch (Exception e) {
            logger.warn("Wait DingTalk appStreamResponse failed.", e);
            return false;
        }
    }

    private AssistantChatDto buildAssistantChatDto(
        AuthDigitEmployVo digitEmployVo,
        String sessionExtValue,
        DingtalkCallbackMessage DDMessage
    ) {
        String conversationType = DDMessage.getConversationType();
        String senderStaffId = DDMessage.getSenderStaffId();
        String conversationId = DDMessage.getConversationId();
        String userText = DDMessage.getTextContent();

        AssistantChatDto assistantChatDto = new AssistantChatDto();
        // assistantChatDto.setAssistantId(-1L);
        assistantChatDto.setAccessTerminal(ChannelType.DINGTALK.getCode());
        assistantChatDto.setChatContent(userText == null || userText.isBlank() ? "" : userText);
        assistantChatDto.setRelModelId("-1");
        assistantChatDto.setAgentId(digitEmployVo.getId());
        assistantChatDto.setAgentType(digitEmployVo.getAgentType());
        assistantChatDto.setSessionId(dingtalkSessionService.resolveSessionId(
                userText,
                sessionExtValue,
                digitEmployVo.getId()
        ));
        assistantChatDto.setResourceList(buildResourceList(digitEmployVo));
        assistantChatDto.setClientRequestId(AssistantChatService.getClientRequestId());



        Map<String, String> channelExt = new HashMap<>();
        channelExt.put(ChatChannelExtensionKeys.CHANNEL_TYPE, AssistantAccessChannel.DINGTALK.getTypeCode());
        channelExt.put(ChatChannelExtensionKeys.DINGTALK_CONVERSATION_TYPE, conversationType == null ? "" : conversationType);
        channelExt.put(ChatChannelExtensionKeys.DINGTALK_CONVERSATION_ID, conversationId == null ? "" : conversationId);
        channelExt.put(ChatChannelExtensionKeys.DINGTALK_SENDER_STAFF_ID, senderStaffId == null ? "" : senderStaffId);
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

    private List<Map<String, Object>> buildExtParamFiles(List<MessageFileDto> messageFiles, LoginInfo userInfo) {
        if (CollectionUtils.isEmpty(messageFiles)) {
            return Collections.emptyList();
        }

        Map<String, Object> extParamFile = new LinkedHashMap<>();
        extParamFile.put("knowledgeId", userInfo.getSessionDatasetId() == null
                ? ""
                : String.valueOf(userInfo.getSessionDatasetId()));
        extParamFile.put("fileIds", messageFiles.stream()
                .map(MessageFileDto::getFileId)
                .filter(StringUtils::hasText)
                .toList());
        extParamFile.put("files", messageFiles.stream()
                .map(this::buildExtParamFileInfo)
                .toList());
        return List.of(extParamFile);
    }

    private Map<String, Object> buildExtParamFileInfo(MessageFileDto messageFile) {
        Map<String, Object> fileInfo = new LinkedHashMap<>();
        fileInfo.put("fileId", messageFile.getFileId());
        fileInfo.put("fileName", messageFile.getFileName());
        fileInfo.put("filePath", messageFile.getFilePath());
        fileInfo.put("fileUrl", StringUtils.hasText(messageFile.getFileUrl()));
        fileInfo.put("fileType", messageFile.getFileType());
        return fileInfo;
    }

    private boolean isSupportedMessageType(String msgtype) {
        return DingtalkMsgType.TEXT.matches(msgtype)
                || DingtalkMsgType.RICH_TEXT.matches(msgtype)
                || DingtalkMsgType.PICTURE.matches(msgtype)
                || DingtalkMsgType.AUDIO.matches(msgtype)
                || DingtalkMsgType.VIDEO.matches(msgtype)
                || DingtalkMsgType.FILE.matches(msgtype)
                || DingtalkMsgType.INTERACTIVE_CARD.matches(msgtype);
    }

    private void logStage(MessageTiming timing, String stage, long started, String status) {
        long now = System.nanoTime();
        logger.info("dingtalk_chain msgId={} requestId={} stage={} status={} durationMs={} elapsedMs={} "
                + "preparationActive={} preparationQueued={} chatActive={} chatQueued={}",
            timing.msgId(), timing.requestId(), stage, status,
            TimeUnit.NANOSECONDS.toMillis(now - started), TimeUnit.NANOSECONDS.toMillis(now - timing.receivedAt()),
            preparationExecutor.getActiveCount(), preparationExecutor.getQueue().size(),
            chatExecutor.getActiveCount(), chatExecutor.getQueue().size());
    }

    private void setThreadContext(MessageTiming timing, LoginInfo loginInfo) {
        CurrentUserHolder.clearLoginInfo();
        if (loginInfo != null) {
            CurrentUserHolder.setLoginInfo(loginInfo);
        }
        LocaleContextHolder.setLocaleContext(timing.localeContext());
        MDC.put("dingtalkRequestId", timing.requestId());
    }

    private void clearThreadContext() {
        CurrentUserHolder.clearLoginInfo();
        LocaleContextHolder.resetLocaleContext();
        MDC.remove("dingtalkRequestId");
    }

    private static ThreadPoolExecutor createExecutor(int workers, int queueCapacity, String threadName) {
        if (workers <= 0 || queueCapacity <= 0) {
            throw new IllegalArgumentException("DingTalk worker counts and queue capacities must be positive");
        }
        return new ThreadPoolExecutor(workers, workers, 60L, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(queueCapacity), new MessageThreadFactory(threadName),
            new ThreadPoolExecutor.AbortPolicy());
    }

    private record MessageTiming(String msgId, String requestId, long receivedAt, LocaleContext localeContext) { }

    private static class MessageThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger(1);
        private final String prefix;

        private MessageThreadFactory(String prefix) {
            this.prefix = prefix;
        }

        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, prefix + counter.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        }
    }
}
