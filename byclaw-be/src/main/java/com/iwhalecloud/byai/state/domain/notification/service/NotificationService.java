package com.iwhalecloud.byai.state.domain.notification.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.dto.notification.NotificationManageDto;
import com.iwhalecloud.byai.manager.dto.notification.NotificationQueryDto;
import com.iwhalecloud.byai.manager.dto.notification.NotificationReadDto;
import com.iwhalecloud.byai.manager.entity.notification.ByaiNotification;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.notification.ByaiNotificationMapper;
import com.iwhalecloud.byai.manager.vo.notification.NotificationVO;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.application.service.message.MessageService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.ContentVo;
import com.iwhalecloud.byai.state.domain.chat.enums.MessageType;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.manager.vo.men.MenTaskVo;
import com.iwhalecloud.byai.manager.dto.men.NotifyResultDto;
import com.iwhalecloud.byai.state.domain.message.service.MemoryMessageService;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.manager.NettyArrayOutputStream;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.common.constants.chat.ConversationObjectType;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.dto.ChoiceDto;
import com.iwhalecloud.byai.state.common.dto.DeltaDto;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.common.enums.MessageContentTypeEnum;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import io.netty.channel.ChannelHandlerContext;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.compress.utils.Lists;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.io.IOException;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import static com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum.SYSTEM_RESPONSE;

/**
 * 通知服务类
 *
 * @author yy
 * @date 2024-12-20
 */
@Slf4j
@Service
public class NotificationService {

    @Autowired
    private ByaiNotificationMapper byaiNotificationMapper;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private MemoryMessageService memoryMessageService;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private MessageService messageService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    @Autowired
    private SandboxService sandboxService;

    private static final String USER_NOTIFICATION_PREFIX = "USER_NOTIFICATION_";

    private static final String UNREAD = "0";

    private static final String NOT_DELETED = "0";

    private static final String DELETED = "1";

    private static final short DEFAULT_PRIORITY = 2;

    private static final short SYSTEM_NOTIFICATION_BIZ_TYPE = 0;

    private static final short VERSION_NOTIFICATION_BIZ_TYPE = 2;

    /**
     * 保存通知
     *
     * @param notification 通知信息
     * @param sendToChat 是否发送ES会话
     */
    public NotifyResultDto save(ByaiNotification notification, boolean sendToChat) {

        // 插入通知表
        int result = byaiNotificationMapper.insert(notification);
        if (!sendToChat) {
            NotifyResultDto notifyResultDto = new NotifyResultDto();
            notifyResultDto.setSuccess(result > 0);
            return notifyResultDto;
        }

        // 创建会话并发送消息
        Long sessionId = this.createSession(notification);
        Long messageId = this.sendMessage(sessionId, notification);

        // 封装返回结果
        NotifyResultDto notifyResultDto = new NotifyResultDto();
        notifyResultDto.setSuccess(true);
        notifyResultDto.setSessionId(sessionId);
        notifyResultDto.setMessageId(messageId);
        return notifyResultDto;
    }

    /**
     * 管理端分页查询通知。
     */
    public Page<NotificationVO> queryManagePage(NotificationQueryDto queryDto) {
        NotificationQueryDto safeQuery = queryDto == null ? new NotificationQueryDto() : queryDto;
        int pageNum = safeQuery.getPageNum() == null || safeQuery.getPageNum() < 1 ? 1 : safeQuery.getPageNum();
        int pageSize = safeQuery.getPageSize() == null || safeQuery.getPageSize() < 1 ? 10 : safeQuery.getPageSize();
        return byaiNotificationMapper.selectNotificationPage(new Page<>(pageNum, pageSize), safeQuery);
    }

    /**
     * 管理端查询通知详情。
     */
    public ByaiNotification getManageNotification(Long id) {
        if (id == null) {
            throw new IllegalArgumentException("Notification id cannot be null");
        }
        ByaiNotification notification = byaiNotificationMapper.selectById(id);
        if (notification == null || DELETED.equals(notification.getIsDeleted())) {
            return null;
        }
        return notification;
    }

    /**
     * 查询最新版本通知。
     */
    public ByaiNotification getLatestVersionNotification() {
        LambdaQueryWrapper<ByaiNotification> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiNotification::getBizType, VERSION_NOTIFICATION_BIZ_TYPE)
            .eq(ByaiNotification::getIsDeleted, NOT_DELETED)
            .orderByDesc(ByaiNotification::getCreateTime)
            .orderByDesc(ByaiNotification::getId)
            .last("LIMIT 1");
        return byaiNotificationMapper.selectOne(queryWrapper);
    }

    /**
     * 管理端创建通知，复用现有保存能力。
     */
    public ByaiNotification createManageNotification(NotificationManageDto request) {
        validateManageRequest(request, false);
        ByaiNotification notification = new ByaiNotification();
        notification.setId(sequenceService.nextVal());
        applyManageFields(notification, request);
        if (notification.getBizType() != SYSTEM_NOTIFICATION_BIZ_TYPE) {
            notification.setIsRead(UNREAD);
        }
        notification.setIsDeleted(NOT_DELETED);
        notification.setCreateTime(new Date());
        if (notification.getPriority() == null && notification.getBizType() != VERSION_NOTIFICATION_BIZ_TYPE) {
            notification.setPriority(DEFAULT_PRIORITY);
        }
        if (notification.getSenderId() == null) {
            notification.setSenderId(CurrentUserHolder.getCurrentUserId());
        }
        save(notification, false);
        return notification;
    }

    /**
     * 管理端更新通知基础信息。
     */
    public ByaiNotification updateManageNotification(NotificationManageDto request) {
        validateManageRequest(request, true);
        ByaiNotification notification = byaiNotificationMapper.selectById(request.getId());
        if (notification == null || DELETED.equals(notification.getIsDeleted())) {
            throw new IllegalArgumentException("Notification does not exist");
        }
        applyManageFields(notification, request);
        byaiNotificationMapper.updateById(notification);
        return notification;
    }

    /**
     * 管理端逻辑删除通知。
     */
    public boolean deleteManageNotification(Long id) {
        if (id == null) {
            throw new IllegalArgumentException("Notification id cannot be null");
        }
        ByaiNotification notification = new ByaiNotification();
        notification.setId(id);
        notification.setIsDeleted(DELETED);
        return byaiNotificationMapper.updateById(notification) > 0;
    }

    private void validateManageRequest(NotificationManageDto request, boolean requireId) {
        if (request == null) {
            throw new IllegalArgumentException("Notification request cannot be null");
        }
        if (requireId && request.getId() == null) {
            throw new IllegalArgumentException("Notification id cannot be null");
        }
        if (!requireId && StringUtils.isBlank(request.getTitle())) {
            throw new IllegalArgumentException("Notification title cannot be blank");
        }
        if (!requireId && StringUtils.isBlank(request.getContent())) {
            throw new IllegalArgumentException("Notification content cannot be blank");
        }
    }

    private void applyManageFields(ByaiNotification notification, NotificationManageDto request) {
        if (request.getTitle() != null) {
            notification.setTitle(request.getTitle());
        }
        if (request.getContent() != null) {
            notification.setContent(request.getContent());
        }
        if (request.getBizType() != null) {
            notification.setBizType(request.getBizType());
        }
        if (request.getPriority() != null) {
            notification.setPriority(request.getPriority());
        }
        if (request.getExpireTime() != null) {
            notification.setExpireTime(request.getExpireTime());
        }
        if (request.getExtraInfo() != null) {
            notification.setExtraInfo(request.getExtraInfo());
        }
    }

    /**
     * 创建会话，如果存在则返回，不存在则创建新会话，保证一个人有且只有一个会话
     *
     * @param notification
     * @return
     */
    private Long createSession(ByaiNotification notification) {
        Long targetId = notification.getTargetId();

        // 调用会话服务查询会话列表
        ByaiSession notifySession = sessionService.findNotifySession(targetId);
        if (notifySession != null) {
            return notifySession.getSessionId();
        }

        Long sessionId = sequenceService.nextVal();

        // 创建会话对象并设置属性
        ByaiSession session = new ByaiSession();
        session.setSessionId(sessionId); // 设置会话ID
        session.setCreateTime(new Date()); // 设置创建时间
        session.setParentSessionId(-1L); // 设置父会话为根会话
        session.setSessionName(I18nUtil.get("notification.session.name.assistant")); // 设置会话名称
        session.setObjectType(ConversationObjectType.NOTIFICATION); // 设置对象类型
        session.setSessionType(SessionType.H_AS.getCode());
        session.setCreatorId(targetId); // 设置创建者ID
        session.setIsDebug(DebugModeEnum.DEBUG_0.getNum()); // 设置为非调试会话
        session.setEnterpriseId(CurrentUserHolder.getEnterpriseId()); // 设置企业ID

        // 保存会话到数据库
        sessionService.save(session);

        return sessionId;
    }

    /**
     * 发送通知消息
     *
     * @param sessionId
     * @param notification
     */
    private Long sendMessage(Long sessionId, ByaiNotification notification) {
        String content = notification.getContent();
        String extraInfo = notification.getExtraInfo();
        String contentType = notification.getContentType();
        Long targetId = notification.getTargetId();
        ContentVo contentVo = null;

        if (StringUtils.isNotEmpty(extraInfo)) {
            // 待办的任务，则从里面获取实际的 contentType
            if (extraInfo.contains("resComId")) {
                MenTaskVo task = JSONObject.parseObject(extraInfo, MenTaskVo.class);
                if (task != null) {
                    if (StringUtils.isEmpty(contentType)) {
                        Integer resType = task.getResType();
                        contentType = String.valueOf(resType);
                    }
                }
            }
            contentVo = new ContentVo(contentType, extraInfo);
        }
        else {
            if (StringUtils.isEmpty(contentType)) {
                contentType = MessageContentTypeEnum.TEXT.getCode();
            }
            contentVo = new ContentVo(contentType, content);
        }
        MessageContext messageContext = new MessageContext(AgentTypeEnum.AGENT, sequenceService.nextVal());
        messageContext.setAnswerText(new StringBuilder(content));

        List<AnswerDelta> msgStructList = Lists.newArrayList();
        msgStructList.add(messageService.generateMsgAnswerDelta(contentVo));
        messageContext.setAnswerMessageList(msgStructList);

        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setSessionId(sessionId);
        ByaiMessageHotDto byaiMessageHotDto = memoryMessageService.save(sessionId, SYSTEM_RESPONSE.getCode(),
            messageContext, assistantChatDto);
        if (byaiMessageHotDto != null && byaiMessageHotDto.getMessageId() != null) {
            String userNotifKey = this.getUserNotifKey(targetId);
            // 给标识ws设置有新消息
            RedisUtil.setString(userNotifKey, String.valueOf(sessionId));
        }

        return byaiMessageHotDto.getMessageId();
    }

    /**
     * 更新消息
     */
    public void updateMessage(Long messageId, String extraInfo) {
        // 先查出当前的消息内容

        ByaiMessageHotDto byaiMessageHotDto = byaiMessageHotService.findById(messageId);
        if (byaiMessageHotDto == null) {
            return;
        }

        // 将ByaiMessageResponse转换为Map<String, Object>
        String messageStruct = byaiMessageHotDto.getMessageStruct();
        if (StringUtils.isEmpty(messageStruct)) {
            return;
        }
        List<AnswerDelta> msgStructList = JSON.parseArray(messageStruct, AnswerDelta.class);
        if (CollectionUtils.isEmpty(msgStructList)) {
            return;
        }
        AnswerDelta answerDelta = msgStructList.get(0);
        List<ChoiceDto> choices = answerDelta.getChoices();
        if (CollectionUtils.isEmpty(choices)) {
            return;
        }
        DeltaDto deltaDto = choices.get(0).getDelta();
        String content = deltaDto.getContent();
        if (StringUtils.isEmpty(content)) {
            return;
        }

        deltaDto.setContent(extraInfo);

        // 更新msgStructList中的数据
        choices.get(0).setDelta(deltaDto);
        answerDelta.setChoices(choices);
        msgStructList.set(0, answerDelta);

        MessageContext messageContext = new MessageContext(AgentTypeEnum.AGENT, messageId);
        messageContext.setAnswerText(new StringBuilder(content));

        messageContext.setAnswerMessageList(msgStructList);

        AssistantChatDto assistantChatDto = new AssistantChatDto();
        Long sessionId = byaiMessageHotDto.getSessionId();
        assistantChatDto.setSessionId(sessionId);
        // 用新增的方式去 update
        memoryMessageService.save(sessionId, SYSTEM_RESPONSE.getCode(), messageContext, assistantChatDto);
    }

    public void getRealTimeNotification(ChannelHandlerContext ctx, String message) {
        LoginInfo currentUser = ctx.channel().attr(Constant.ATT_USER_INFO).get();
        // 沙箱心跳
        try {
            sandboxService.heartbeat(currentUser.getUserCode(), -1L);
        }
        catch (Exception e) {
            log.error("ws 沙箱心跳保持异常", e);
        }

        Long userId = currentUser.getUserId();
        Long enterpriseId = currentUser.getEnterpriseId();
        String sessionId = RedisUtil.getString(this.getUserNotifKey(userId));
        if (StringUtils.isEmpty(sessionId)) {
            return;
        }

        ByaiSession complexNotifSession = sessionService.findNotifySession(userId);
        if (complexNotifSession == null) {
            return;
        }
        Map data = new HashMap();
        data.put("type", MessageType.NOTIFICATION.name());
        data.put("session", complexNotifSession);
        try (NettyArrayOutputStream outputStream = new NettyArrayOutputStream(ctx)) {
            CompletionsUtils.responseWrite(outputStream, JsonUtil.toJSONString(data));
        }
        catch (IOException e) {
            log.error("Error processing getRealTimeNotification", e);
        }
    }

    private String getUserNotifKey(Long userId) {
        return USER_NOTIFICATION_PREFIX + userId;
    }

    /**
     * 批量设置通知已读
     *
     * @param notificationReadDto 已读参数
     * @return ResultUtil
     */
    public int batchSetNotificationRead(NotificationReadDto notificationReadDto) {

        try {

            log.info("批量设置通知已读，参数：{}", notificationReadDto);

            int updateCount = 0;

            // 判断read参数
            if ("ALL".equalsIgnoreCase(notificationReadDto.getRead())) {
                // 设置当前用户所有通知为已读
                updateCount = byaiNotificationMapper.setAllNotificationRead(notificationReadDto.getTargetId());
                log.info("设置所有通知已读完成，更新了{}条记录", updateCount);
            }
            else {
                // 批量设置指定ID的通知为已读
                updateCount = byaiNotificationMapper.batchSetNotificationRead(notificationReadDto.getIdList(),
                    notificationReadDto.getTargetId());
            }

            // 清除给标识ws，防止一直给用户推送消息
            String userNotifKey = this.getUserNotifKey(notificationReadDto.getTargetId());
            RedisUtil.removeKey(userNotifKey);

            log.info("批量设置指定通知已读完成，更新了{}条记录", updateCount);

            return updateCount;
        }
        catch (Exception e) {
            log.error("批量设置通知已读异常", e);
            throw e;
        }
    }

}
