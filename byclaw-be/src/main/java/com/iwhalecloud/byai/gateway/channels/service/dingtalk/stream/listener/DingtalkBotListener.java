package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import jakarta.annotation.PreDestroy;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.constants.users.SourceType;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.channels.enums.AssistantAccessChannel;
import com.iwhalecloud.byai.gateway.channels.enums.ChannelType;
import com.iwhalecloud.byai.gateway.channels.enums.ChatChannelExtensionKeys;
import com.iwhalecloud.byai.gateway.channels.service.ChannelService;
import com.iwhalecloud.byai.gateway.channels.service.ChannelServiceFactory;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkFileDownloadService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkReplyDispatcher;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkTokenService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkUserService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.card.DingtalkCardService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.card.DingtalkCardStreamSession;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.card.DingtalkCardStreamingOutputStream;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkMessageDownloadInfo;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkMessageFileDownloadResult;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.support.DingtalkCallbackMessageParser;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.support.DingtalkDownloadedMultipartFile;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.entity.users.UserExternalSystem;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.qo.index.MyAuthEmployQo;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.collections.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.dingtalk.open.app.api.callback.OpenDingTalkCallbackListener;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

/**
 * 钉钉 Stream 机器人回调监听器。
 * 负责用户识别、可用数字员工鉴权、调用后端对话，以及将结果以“拟流式”方式回推到钉钉 webhook。
 */
@Service
public class DingtalkBotListener implements OpenDingTalkCallbackListener<Map<String, Object>, Map<String, Object>> {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkBotListener.class);
    private static final String DEFAULT_FALLBACK_REPLY = "抱歉，遇到了点问题，请稍后再试";
    private static final Pattern USER_CODE_PATTERN = Pattern.compile("(?i)user\\s*code\\s*[:=]?\\s*([a-zA-Z0-9_\\-]+)");
    private static final String EXT_CODE_PREFIX = "dingtalkConversationId";
    private static final String MESSAGE_DEDUP_KEY_PREFIX = "dingtalk:stream:msg:";
    private static final long MESSAGE_DEDUP_TTL_SECONDS = 30 * 60L;

    private static final String MSG_TYPE_TEXT = "text";
    private static final String MSG_TYPE_RICH_TEXT = "richText";
    private static final String MSG_TYPE_PICTURE = "picture";
    private static final String MSG_TYPE_AUDIO = "audio";
    private static final String MSG_TYPE_VIDEO = "video";
    private static final String MSG_TYPE_FILE = "file";
    private static final String UNSUPPORTED_MESSAGE_REPLY = "暂不支持该类型消息";

    private final ObjectMapper objectMapper;
    private final DingtalkTokenService dingtalkTokenService;
    private final DingtalkUserService dingtalkUserService;
    private final DingtalkFileDownloadService dingtalkFileDownloadService;
    private final DingtalkReplyDispatcher dingtalkReplyDispatcher;
    private final DingtalkCardService dingtalkCardService;
    private final DingtalkCallbackMessageParser dingtalkCallbackMessageParser;
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
    private UserService userService;
    @Autowired
    private IndexService indexService;
    @Autowired
    private SessionService sessionService;
    @Autowired
    private SequenceService sequenceService;
    @Autowired
    private SessionExtService sessionExtService;
    @Autowired
    private EnterpriseInfoService enterpriseInfoService;
    @Autowired
    private UserExternalSystemService userExternalSystemService;
    @Autowired
    private com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService assistantChatApplicationService;

    public DingtalkBotListener(
            ObjectMapper objectMapper,
            DingtalkTokenService dingtalkTokenService,
            DingtalkUserService dingtalkUserService,
            DingtalkFileDownloadService dingtalkFileDownloadService,
            DingtalkReplyDispatcher dingtalkReplyDispatcher,
            DingtalkCardService dingtalkCardService,
            DingtalkCallbackMessageParser dingtalkCallbackMessageParser
    ) {
        this.objectMapper = objectMapper;
        this.dingtalkTokenService = dingtalkTokenService;
        this.dingtalkUserService = dingtalkUserService;
        this.dingtalkFileDownloadService = dingtalkFileDownloadService;
        this.dingtalkReplyDispatcher = dingtalkReplyDispatcher;
        this.dingtalkCardService = dingtalkCardService;
        this.dingtalkCallbackMessageParser = dingtalkCallbackMessageParser;
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

        if (!isSupportedMessageType(msgtype)) {
            try {
                dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, UNSUPPORTED_MESSAGE_REPLY);
            } catch (IOException e) {
                logger.error("Failed to reply unsupported DingTalk message type. msgId={}, msgtype={}", msgId, msgtype, e);
            }
            return new HashMap<>();
        }

        if (isDuplicateMessage(msgId)) {
            logger.info("Skip duplicate DingTalk bot message. msgId={}, conversationId={}, senderStaffId={}",
                    msgId, conversationId, senderStaffId);
            return new HashMap<>();
        }

        // 异步处理业务逻辑，避免阻塞 SDK 回调线程导致心跳 ping timeout。
        messageExecutor.execute(() -> handleMessageAsync(DDMessage));

        return new HashMap<>();
    }

    private void handleMessageAsync(DingtalkCallbackMessage DDMessage) {
        String msgId = DDMessage.getMsgId();
        String sessionWebhook = DDMessage.getSessionWebhook();
        String robotCode = DDMessage.getRobotCode();
        String senderStaffId = DDMessage.getSenderStaffId();

        try {
            LoginInfo userInfo = this.resolveLoginInfo(DDMessage);
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

            List<MessageFileDto> messageFiles = downloadMessageFiles(DDMessage, assistantChatDto);
            if (CollectionUtils.isNotEmpty(messageFiles)) {
                assistantChatDto.setFiles(messageFiles);
                assistantChatDto.getExtParams().put("files", messageFiles);
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

        // 群聊下同一个 conversationId 会被多人共享，这里拼上 senderStaffId，把会话粒度收敛到“群 + 人”。
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

    private LoginInfo resolveLoginInfo(
        DingtalkCallbackMessage DDMessage
    ) throws IOException {
        String senderStaffId = DDMessage.getSenderStaffId();
        String robotCode = DDMessage.getRobotCode();
        String textContent = DDMessage.getTextContent();
        String sessionWebhook = DDMessage.getSessionWebhook();

        // 先用外部系统映射表做快速定位；命中且本地用户存在时，直接登录。
        Users matchedUser = findMatchedUserFromExternalSystem(senderStaffId);
        if (matchedUser != null) {
            logger.info("Matched DingTalk user from po_user_external_system by senderStaffId. senderStaffId={}, userId={}",
                    senderStaffId, matchedUser.getUserId());
            return buildLoginInfo(matchedUser);
        }

        com.dingtalk.api.response.OapiV2UserGetResponse.UserGetResponse userDetail = fetchUserDetail(senderStaffId, robotCode);

        // 拿到钉钉用户详情后，再按外部唯一标识补查一次映射表，并在成功识别后回写映射。
        String unionId = resolveExternalUnionId(senderStaffId, userDetail);
        matchedUser = findMatchedUserFromExternalSystem(unionId);
        if (matchedUser != null) {
            logger.info("Matched DingTalk user from po_user_external_system by unionId. senderStaffId={}, unionId={}, userId={}",
                    senderStaffId, unionId, matchedUser.getUserId());
            saveUserExternalSystem(unionId, matchedUser.getUserId(), userDetail);
            return buildLoginInfo(matchedUser);
        }

        LoginInfo userInfo = resolveLoginInfoFromUserDetail(sessionWebhook, textContent, userDetail);
        if (userInfo != null) {
            saveUserExternalSystem(unionId, userInfo.getUserId(), userDetail);
        }
        return userInfo;
    }

    private com.dingtalk.api.response.OapiV2UserGetResponse.UserGetResponse fetchUserDetail(
        String senderStaffId,
        String robotCode
    ) throws IOException {
        com.dingtalk.api.response.OapiV2UserGetResponse.UserGetResponse userDetail =
                dingtalkUserService.getUserDetail(
                        dingtalkTokenService.getAccessToken(senderStaffId, robotCode),
                        senderStaffId
                );
        logger.info("Fetched DingTalk user detail. senderStaffId={}, userId={}, unionId={}, name={}, mobile={}, email={}, jobNumber={}",
                senderStaffId,
                userDetail.getUserid(),
                userDetail.getUnionid(),
                userDetail.getName(),
                userDetail.getMobile(),
                userDetail.getEmail(),
                userDetail.getJobNumber());
        return userDetail;
    }

    private Users findMatchedUserFromExternalSystem(String unionId) {
        if (unionId == null || unionId.isBlank()) {
            return null;
        }

        // po_user_external_system 只保存外部账号到本地用户的绑定，真正可登录的用户信息仍以 Users 为准。
        UserExternalSystem externalSystem = userExternalSystemService.findByUnionId(SourceType.DING_TALK, unionId);
        if (externalSystem == null || externalSystem.getUserId() == null) {
            return null;
        }

        Users matchedUser = userService.findById(externalSystem.getUserId());
        if (matchedUser == null) {
            logger.warn("Found po_user_external_system record but local user is missing. unionId={}, userId={}",
                    unionId, externalSystem.getUserId());
        }
        return matchedUser;
    }

    private LoginInfo resolveLoginInfoFromUserDetail(String sessionWebhook, String textContent,
                                                     com.dingtalk.api.response.OapiV2UserGetResponse.UserGetResponse userDetail)
            throws IOException {
        List<Users> users = findUsersByUserDetail(userDetail);
        String resolvedSenderNick = userDetail == null ? null : userDetail.getName();
        if (users == null || users.isEmpty()) {
            dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, "未找到匹配的系统用户，请联系管理员创建账号后再试。");
            return null;
        }

        String selectedUserCode = extractSelectedUserCode(textContent);
        if (selectedUserCode != null) {
            users = filterUsersBySelectedUserCode(users, selectedUserCode);
            if (users.isEmpty()) {
                dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, "未找到 userCode=" + selectedUserCode + " 对应用户，请从候选列表中选择。");
                return null;
            }
        }

        if (users.size() > 1) {
            // 多个同名用户时引导用户通过 userCode 二次选择
            dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, buildMultipleUsersPrompt(resolvedSenderNick, users));
            return null;
        }

        Users matchedUser = users.get(0);
        return buildLoginInfo(matchedUser);
    }

    private List<Users> findUsersByUserDetail(com.dingtalk.api.response.OapiV2UserGetResponse.UserGetResponse userDetail) {
        List<Users> users = new ArrayList<>();

        String jobNumber = userDetail == null ? null : userDetail.getJobNumber();
        if (jobNumber != null && !jobNumber.isBlank()) {
            Users matchedByUserCode = userService.findByUserCode(jobNumber);
            if (matchedByUserCode != null) {
                users.add(matchedByUserCode);
            }
        }

        if (!users.isEmpty()) {
            return users;
        }

        String mobile = userDetail == null ? null : userDetail.getMobile();
        if (mobile != null && !mobile.isBlank()) {
            Users matchedByMobile = userService.findByUserPhone(mobile);
            if (matchedByMobile != null) {
                users.add(matchedByMobile);
            }
        }

        if (!users.isEmpty()) {
            return users;
        }

        String resolvedSenderNick = userDetail == null ? null : userDetail.getName();
        return userService.findByUserName(resolvedSenderNick);
    }

    private List<Users> filterUsersBySelectedUserCode(List<Users> users, String selectedUserCode) {
        return users.stream()
                .filter(user -> user.getUserCode() != null)
                .filter(user -> user.getUserCode().equalsIgnoreCase(selectedUserCode))
                .collect(Collectors.toList());
    }

    private LoginInfo buildLoginInfo(Users matchedUser) {
        LoginInfo userInfo = new LoginInfo();
        userInfo.setUserId(matchedUser.getUserId());
        userInfo.setUserCode(matchedUser.getUserCode());
        userInfo.setUserName(matchedUser.getUserName());
        userInfo.setAssistantId(matchedUser.getAssistantId());
        userInfo.setEnterpriseId(enterpriseInfoService.getEnterpriseId());
        CurrentUserHolder.setLoginInfo(userInfo);
        return userInfo;
    }

    private String resolveExternalUnionId(String senderStaffId,
                                          com.dingtalk.api.response.OapiV2UserGetResponse.UserGetResponse userDetail) {
        // 优先使用钉钉返回的 unionid，拿不到时回退到 senderStaffId，保证映射链路可落库。
        String unionId = userDetail == null ? null : userDetail.getUnionid();
        if (unionId != null && !unionId.isBlank()) {
            return unionId;
        }
        return senderStaffId;
    }

    private void saveUserExternalSystem(String unionId, Long userId,
                                        com.dingtalk.api.response.OapiV2UserGetResponse.UserGetResponse userDetail) {
        if (unionId == null || unionId.isBlank() || userId == null || userDetail == null) {
            return;
        }

        // 已有绑定则刷新钉钉侧属性，没有绑定则新建一条 po_user_external_system 映射。
        UserExternalSystem existing = userExternalSystemService.findByUnionId(SourceType.DING_TALK, unionId);
        if (existing != null) {
            existing.setUserId(userId);
            existing.setSourceAccount(userDetail.getJobNumber());
            existing.setSourceNickname(userDetail.getName());
            existing.setSourceEmail(userDetail.getEmail());
            if (existing.getBindingTime() == null) {
                existing.setBindingTime(new Date());
            }
            userExternalSystemService.update(existing);
            return;
        }

        UserExternalSystem userExternalSystem = new UserExternalSystem();
        userExternalSystem.setId(sequenceService.nextVal());
        userExternalSystem.setUserId(userId);
        userExternalSystem.setSourceType(SourceType.DING_TALK);
        userExternalSystem.setSourceAccount(userDetail.getJobNumber());
        userExternalSystem.setSourceNickname(userDetail.getName());
        userExternalSystem.setSourceEmail(userDetail.getEmail());
        userExternalSystem.setBindingTime(new Date());
        userExternalSystem.setUnionId(unionId);
        userExternalSystemService.save(userExternalSystem);
    }

    private String extractSelectedUserCode(String textContent) {
        if (textContent == null || textContent.isBlank()) {
            return null;
        }
        Matcher matcher = USER_CODE_PATTERN.matcher(textContent);
        if (!matcher.find()) {
            return null;
        }
        return matcher.group(1).trim();
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
            dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, e.getMessage());
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
        assistantChatDto.setAssistantId(-1L);
        assistantChatDto.setAccessTerminal(ChannelType.DINGTALK.getCode());
        assistantChatDto.setChatContent(userText == null || userText.isBlank() ? " " : userText);
        assistantChatDto.setRelModelId(-1L);
        assistantChatDto.setAgentId(digitEmployVo.getId());
        assistantChatDto.setAgentType(digitEmployVo.getAgentType());
        assistantChatDto.setSessionId(resolveSessionId(userText, sessionExtValue, digitEmployVo.getId()));

        Map<String, String> channelExt = new HashMap<>();
        channelExt.put(ChatChannelExtensionKeys.CHANNEL_TYPE, AssistantAccessChannel.DINGTALK.getTypeCode());
        channelExt.put(ChatChannelExtensionKeys.DINGTALK_CONVERSATION_TYPE, conversationType == null ? "" : conversationType);
        channelExt.put(ChatChannelExtensionKeys.DINGTALK_CONVERSATION_ID, conversationId == null ? "" : conversationId);
        channelExt.put(ChatChannelExtensionKeys.DINGTALK_SENDER_STAFF_ID, senderStaffId == null ? "" : senderStaffId);
        assistantChatDto.setChannelExtension(channelExt);
        assistantChatDto.getExtParams().put("files", assistantChatDto.getFiles());
        return assistantChatDto;
    }

    private Long resolveSessionId(String userText, String sessionExtValue, Long agentId) {
        // 单聊/群聊的差异只体现在 sessionExtValue 的生成，后续查找和创建会话都统一使用这个键。
        ByaiSessionExt sessionExt = sessionExtService.selectByParamCodeAndValue(buildExtCode(), sessionExtValue);
        if (sessionExt != null) {
            return sessionExt.getSessionId();
        }
        ByaiSession session = createSession(userText, sessionExtValue, agentId);
        return session.getSessionId();
    }

    private ByaiSession createSession(String userText, String sessionExtValue, Long agentId) {
        Long sessionId = sequenceService.nextVal();

        ByaiSession session = new ByaiSession();
        session.setSessionName(userText);
        session.setSessionContent(userText);
        session.setCreateTime(new Date());
        session.setObjectId(agentId);
        session.setObjectType("DigEmployee");
        session.setSessionType(SessionType.H_AS.getCode());
        session.setSessionId(sessionId);
        session.setIsDebug(0);
        session.setCreatorId(CurrentUserHolder.getCurrentUserId());
        session.setCreateTime(new Date());
        session.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        sessionService.save(session);

        ByaiSessionExt ext = new ByaiSessionExt();
        ext.setExtId(sequenceService.nextVal());
        ext.setSessionId(sessionId);
        ext.setExtParamName("钉钉会话ID");
        ext.setExtParamCode(buildExtCode());
        ext.setExtParamValue(sessionExtValue);
        sessionExtService.save(ext);

        return session;
    }

    private String buildExtCode() {
        return EXT_CODE_PREFIX;
    }

    private boolean isSupportedMessageType(String msgtype) {
        return MSG_TYPE_TEXT.equalsIgnoreCase(msgtype)
                || MSG_TYPE_RICH_TEXT.equalsIgnoreCase(msgtype)
                || MSG_TYPE_PICTURE.equalsIgnoreCase(msgtype)
                || MSG_TYPE_FILE.equalsIgnoreCase(msgtype);
    }

    private List<MessageFileDto> downloadMessageFiles(DingtalkCallbackMessage DDMessage, AssistantChatDto assistantChatDto) {
        List<DingtalkMessageDownloadInfo> downloadInfos = extractDownloadInfos(DDMessage);
        String senderStaffId = DDMessage.getSenderStaffId();
        String robotCode = DDMessage.getRobotCode();
        if (downloadInfos.isEmpty()) {
            return Collections.emptyList();
        }

        String accessToken = dingtalkTokenService.getAccessToken(senderStaffId, robotCode);

        List<MultipartFile> multipartFiles = new ArrayList<>();
        int idx = 0;
        for (DingtalkMessageDownloadInfo downloadInfo : downloadInfos) {
            DingtalkMessageFileDownloadResult downloadResult =
                    dingtalkFileDownloadService.downloadMessageFile(
                            accessToken,
                            downloadInfo.getDownloadCode(),
                            robotCode,
                            downloadInfo.getFileName()
                        );
            logger.info("downloadMessageFiles={}, downloadCode={}", downloadResult, downloadInfo.getDownloadCode());

            byte[] fileBytes = dingtalkFileDownloadService.downloadMessageFileBinary(downloadResult);
            String fileName = downloadResult.getFileName();
  
            String contentType = downloadResult.getContentType();

            multipartFiles.add(new DingtalkDownloadedMultipartFile(
                    "file" + (idx++), fileName, contentType, fileBytes));
        }

        if (multipartFiles.isEmpty()) {
            return Collections.emptyList();
        }

        try {
            com.iwhalecloud.byai.manager.dto.session.SessionUploadResult uploadResult =
                    assistantChatApplicationService.uploadFiles(
                            multipartFiles.toArray(new MultipartFile[0]),
                            assistantChatDto.getSessionId(),
                            SessionType.H_AS.getCode(),
                            assistantChatDto.getAgentId()
                    );

            if (uploadResult != null && uploadResult.getSessionId() != null) {
                assistantChatDto.setSessionId(uploadResult.getSessionId());
            }

            List<MessageFileDto> messageFiles = new ArrayList<>();
            if (uploadResult != null && CollectionUtils.isNotEmpty(uploadResult.getUploadItems())) {
                for (com.iwhalecloud.byai.manager.dto.resource.UploadItem item : uploadResult.getUploadItems()) {
                    MessageFileDto dto = new MessageFileDto();
                    dto.setFileId(item.getFileId() == null ? null : String.valueOf(item.getFileId()));
                    dto.setFileName(item.getFileName());
                    dto.setFilePath(item.getFilePath());
                    dto.setFileUrl(item.getFileUrl());
                    dto.setUseType("content");
                    messageFiles.add(dto);
                }
            }
            return messageFiles;
        } catch (Exception e) {
            logger.error("Upload DingTalk message files failed. senderStaffId={}, robotCode={}, fileCount={}",
                    senderStaffId, robotCode, multipartFiles.size(), e);
            return Collections.emptyList();
        }
    }

    public Set<String> extractDownloadCodes(DingtalkCallbackMessage DDMessage) {
        return extractDownloadInfos(DDMessage).stream()
                .map(DingtalkMessageDownloadInfo::getDownloadCode)
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    public List<DingtalkMessageDownloadInfo> extractDownloadInfos(DingtalkCallbackMessage DDMessage) {
        Map<String, DingtalkMessageDownloadInfo> downloadInfoMap = new LinkedHashMap<>();

        String msgtype = DDMessage.getMsgtype();
        Object contentNode = DDMessage.getContent();
        if (MSG_TYPE_RICH_TEXT.equalsIgnoreCase(msgtype)) {
            collectRichTextDownloadInfos(contentNode, downloadInfoMap);
            return new ArrayList<>(downloadInfoMap.values());
        }
        if (hasDirectContentDownloadCode(msgtype)) {
            collectDownloadInfoFromMap(contentNode, downloadInfoMap);
            return new ArrayList<>(downloadInfoMap.values());
        }
        return Collections.emptyList();
    }

    private boolean hasDirectContentDownloadCode(String msgtype) {
        return MSG_TYPE_PICTURE.equalsIgnoreCase(msgtype)
                || MSG_TYPE_AUDIO.equalsIgnoreCase(msgtype)
                || MSG_TYPE_VIDEO.equalsIgnoreCase(msgtype)
                || MSG_TYPE_FILE.equalsIgnoreCase(msgtype);
    }

    private void collectDownloadInfoFromMap(Object node, Map<String, DingtalkMessageDownloadInfo> downloadInfoMap) {
        if (node instanceof Map<?, ?> nodeMap) {
            addDownloadInfo(nodeMap.get("downloadCode"), nodeMap.get("fileName"), downloadInfoMap);
        }
    }

    private void collectRichTextDownloadInfos(Object contentNode, Map<String, DingtalkMessageDownloadInfo> downloadInfoMap) {
        if (!(contentNode instanceof Map<?, ?> contentMap)) {
            return;
        }
        Object richTextNode = contentMap.get("richText");
        if (!(richTextNode instanceof Collection<?> richTextItems)) {
            return;
        }
        for (Object richTextItem : richTextItems) {
            if (!(richTextItem instanceof Map<?, ?> itemMap)) {
                continue;
            }
            addDownloadInfo(itemMap.get("downloadCode"), itemMap.get("fileName"), downloadInfoMap);
        }
    }

    private void addDownloadInfo(Object downloadCodeNode, Object fileNameNode,
                                 Map<String, DingtalkMessageDownloadInfo> downloadInfoMap) {
        if (downloadCodeNode == null) {
            return;
        }
        String downloadCode = String.valueOf(downloadCodeNode);
        if (downloadCode.isBlank()) {
            return;
        }
        String fileName = fileNameNode == null ? null : String.valueOf(fileNameNode);
        downloadInfoMap.putIfAbsent(downloadCode, new DingtalkMessageDownloadInfo(
                downloadCode, StringUtils.hasText(fileName) ? fileName : null));
    }

    private String buildMultipleUsersPrompt(String senderNick, List<Users> users) {
        StringBuilder builder = new StringBuilder();
        builder.append("检测到昵称【").append(senderNick).append("】匹配到多个用户，请回复以下 userCode 之一进行选择：\n");
        for (Users user : users) {
            builder.append("- userCode: ")
                    .append(user.getUserCode())
                    .append("，userName: ")
                    .append(user.getUserName())
                    .append("\n");
        }
        builder.append("示例：回复“选择 userCode=xxx”");
        return builder.toString();
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
