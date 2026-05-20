package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import jakarta.annotation.PreDestroy;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.channels.enums.AssistantAccessChannel;
import com.iwhalecloud.byai.gateway.channels.enums.ChannelType;
import com.iwhalecloud.byai.gateway.channels.enums.ChatChannelExtensionKeys;
import com.iwhalecloud.byai.gateway.channels.service.ChannelService;
import com.iwhalecloud.byai.gateway.channels.service.ChannelServiceFactory;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkFileDownloadService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkReplyDispatcher;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkSessionService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkUserService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.cards.DingtalkCardService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.cards.DingtalkCardStreamSession;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.cards.DingtalkCardStreamingOutputStream;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkMsgType;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.support.DingtalkCallbackMessageParser;
import com.iwhalecloud.byai.manager.qo.index.MyAuthEmployQo;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import org.apache.commons.collections.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.dingtalk.open.app.api.callback.OpenDingTalkCallbackListener;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class DingtalkBotListener implements OpenDingTalkCallbackListener<Map<String, Object>, Map<String, Object>> {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkBotListener.class);
    private static final String DEFAULT_FALLBACK_REPLY = "抱歉，遇到了点问题，请稍后再试";
    private static final String MESSAGE_DEDUP_KEY_PREFIX = "dingtalk:stream:msg:";
    private static final long MESSAGE_DEDUP_TTL_SECONDS = 30 * 60L;

    private static final String UNSUPPORTED_MESSAGE_REPLY = "暂不支持该类型消息";
    private static final String GROUP_UNSUPPORTED_AUDIO_REPLY = "群聊暂不支持该类型消息";

    private final ObjectMapper objectMapper;
    private final DingtalkUserService dingtalkUserService;
    private final DingtalkFileDownloadService dingtalkFileDownloadService;
    private final DingtalkReplyDispatcher dingtalkReplyDispatcher;
    private final DingtalkCardService dingtalkCardService;
    private final DingtalkCallbackMessageParser dingtalkCallbackMessageParser;
    private final DingtalkSessionService dingtalkSessionService;
    private final ExecutorService messageExecutor = new ThreadPoolExecutor(
            8,
            32,
            60L,
            TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(512),
            new MessageThreadFactory(),
            new ThreadPoolExecutor.CallerRunsPolicy()
    );

    @Autowired
    private IndexService indexService;

    public DingtalkBotListener(
            ObjectMapper objectMapper,
            DingtalkUserService dingtalkUserService,
            DingtalkFileDownloadService dingtalkFileDownloadService,
            DingtalkReplyDispatcher dingtalkReplyDispatcher,
            DingtalkCardService dingtalkCardService,
            DingtalkCallbackMessageParser dingtalkCallbackMessageParser,
            DingtalkSessionService dingtalkSessionService
    ) {
        this.objectMapper = objectMapper;
        this.dingtalkUserService = dingtalkUserService;
        this.dingtalkFileDownloadService = dingtalkFileDownloadService;
        this.dingtalkReplyDispatcher = dingtalkReplyDispatcher;
        this.dingtalkCardService = dingtalkCardService;
        this.dingtalkCallbackMessageParser = dingtalkCallbackMessageParser;
        this.dingtalkSessionService = dingtalkSessionService;
    }

    @Override
    public Map<String, Object> execute(Map<String, Object> callbackData) {
        DingtalkCallbackMessage DDMessage = dingtalkCallbackMessageParser.parse(callbackData);
        String msgId = DDMessage.getMsgId();
        String sessionWebhook = DDMessage.getSessionWebhook();
        String conversationType = DDMessage.getConversationType();
        String conversationId = DDMessage.getConversationId();
        String senderStaffId = DDMessage.getSenderStaffId();
        String msgtype = DDMessage.getMsgtype();
        String textContent = DDMessage.getTextContent();

        logger.info("Received DingTalk bot message. msgId={}, msgtype={}, conversationType={}, content={}",
                msgId, msgtype, conversationType, textContent);

        if (sessionWebhook == null || sessionWebhook.isBlank()) {
            logger.warn("Skip replying because sessionWebhook is empty. payload={}", callbackData);
            return new HashMap<>();
        }

        if (isDuplicateMessage(msgId)) {
            logger.info("Skip duplicate DingTalk bot message. msgId={}, conversationId={}, senderStaffId={}",
                    msgId, conversationId, senderStaffId);
            return new HashMap<>();
        }

        if (!isSupportedMessageType(msgtype)) {
            try {
                dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, UNSUPPORTED_MESSAGE_REPLY);
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

        messageExecutor.execute(() -> handleMessageAsync(DDMessage));

        return new HashMap<>();
    }

    private void handleMessageAsync(DingtalkCallbackMessage DDMessage) {
        String msgId = DDMessage.getMsgId();
        String sessionWebhook = DDMessage.getSessionWebhook();
        String robotCode = DDMessage.getRobotCode();
        String senderStaffId = DDMessage.getSenderStaffId();

        try {
            LoginInfo userInfo = dingtalkUserService.resolveLoginInfo(DDMessage);
            if (userInfo == null) {
                return;
            }

            AuthDigitEmployVo digitEmployVo = findAuthorizedDigitEmploy(userInfo.getUserId(), robotCode);
            if (digitEmployVo == null) {
                dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, "对不起，您可能没有数字员工的权限");
                return;
            }

            String sessionExtValue = buildSessionExtValue(DDMessage);
            AssistantChatDto assistantChatDto = buildAssistantChatDto(
                digitEmployVo, sessionExtValue, DDMessage
            );

            List<MessageFileDto> messageFiles = dingtalkFileDownloadService.downloadMessageFiles(DDMessage, assistantChatDto);
            if (CollectionUtils.isNotEmpty(messageFiles)) {
                assistantChatDto.setFiles(messageFiles);
                assistantChatDto.getExtParams().put("files", buildExtParamFiles(messageFiles, userInfo));
                if (assistantChatDto.getChatContent() == null || assistantChatDto.getChatContent().isBlank()) {
                    assistantChatDto.setChatContent(" ");
                }
            }

            replyAssistantMessage(
                digitEmployVo,
                sessionExtValue,
                assistantChatDto,
                DDMessage
            );
        } catch (Exception e) {
            logger.error("Failed to reply DingTalk bot message. msgId={}, senderStaffId={}, robotCode={}",
                    msgId, senderStaffId, robotCode, e);
            try {
                dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, "消息异常：" + e.getMessage());
            } catch (IOException ex) {
                logger.error("Failed to send error message to DingTalk. msgId={}", msgId, ex);
            }
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

    private void replyAssistantMessage(
        AuthDigitEmployVo digitEmployVo,
        String sessionExtValue,
        AssistantChatDto assistantChatDto,
        DingtalkCallbackMessage DDMessage
    ) throws IOException {
        String conversationType = DDMessage.getConversationType();
        String conversationId = DDMessage.getConversationId();
        String senderStaffId = DDMessage.getSenderStaffId();
        String robotCode = DDMessage.getRobotCode();
        String sessionWebhook = DDMessage.getSessionWebhook();

        ChannelService channelService = ChannelServiceFactory.getService(ChannelType.DINGTALK.getCode());

        if (!channelService.validateRequest(assistantChatDto)) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.chat.request.invalid"));
        }

        if (!StringUtils.hasText(robotCode)) {
            dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, "钉钉机器人编码未配置，暂无法回复。");
            return;
        }

        replyAssistantCardStreamingMessage(
            sessionWebhook,
            channelService,
            assistantChatDto,
            senderStaffId,
            robotCode,
            conversationType,
            conversationId,
            digitEmployVo
        );
    }

    private boolean replyAssistantCardStreamingMessage(
            String sessionWebhook,
            ChannelService channelService,
            AssistantChatDto assistantChatDto,
            String senderStaffId,
            String robotCode,
            String conversationType,
            String conversationId,
            AuthDigitEmployVo digitEmployVo
    ) throws IOException {
        DingtalkCardStreamSession cardSession;
        try {
            cardSession = dingtalkCardService.createAssistantReplyCardSession(
                    senderStaffId,
                    robotCode,
                    conversationType,
                    conversationId,
                    digitEmployVo == null ? "" : digitEmployVo.getName()
            );
        } catch (Exception e) {
            logger.warn("Create DingTalk card failed, fallback to text. robotCode={}, senderStaffId={}",
                    robotCode, senderStaffId, e);
            return false;
        }

        DingtalkCardStreamingOutputStream outputStream =
                new DingtalkCardStreamingOutputStream(objectMapper, dingtalkCardService, cardSession);
        try {
            channelService.chat(assistantChatDto, outputStream);
            outputStream.finish();
            if (outputStream.hasStreamingFailed()) {
                dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, DEFAULT_FALLBACK_REPLY);
            }
            return true;
        } catch (Exception e) {
            try {
                outputStream.finish();
            } catch (Exception finishEx) {
                logger.warn("Finalize DingTalk card failed after chat exception. robotCode={}, senderStaffId={}",
                        robotCode, senderStaffId, finishEx);
            }

            throw new RuntimeException(e);
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
        assistantChatDto.setRelModelId(-1L);
        assistantChatDto.setAgentId(digitEmployVo.getId());
        assistantChatDto.setAgentType(digitEmployVo.getAgentType());
        assistantChatDto.setSessionId(dingtalkSessionService.resolveSessionId(
                userText,
                sessionExtValue,
                digitEmployVo.getId()
        ));
        assistantChatDto.setResourceList(buildResourceList(digitEmployVo));

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

    private static class MessageThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger(1);

        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "dingtalk-bot-msg-" + counter.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        }
    }
}
