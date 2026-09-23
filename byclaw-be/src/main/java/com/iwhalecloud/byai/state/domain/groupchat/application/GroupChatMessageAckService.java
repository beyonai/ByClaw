package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatMessageAck;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMessageAckMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.state.common.share.helper.ShareCacheUtil;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;

/** 群消息“收到”确认用例：写确认记录并复用群事件广播。 */
@Service
public class GroupChatMessageAckService {
    private final ByaiGroupChatMessageAckMapper ackMapper;
    private final ByaiGroupChatMentionMapper mentionMapper;
    private final ByaiMessageMapper messageMapper;
    private final GroupChatAuthorizationService authorizationService;
    private final GroupChatEventPublisher eventPublisher;
    private final UserService userService;

    @Autowired
    public GroupChatMessageAckService(ByaiGroupChatMessageAckMapper ackMapper,
        ByaiGroupChatMentionMapper mentionMapper, ByaiMessageMapper messageMapper,
        GroupChatAuthorizationService authorizationService,
        GroupChatEventPublisher eventPublisher, UserService userService) {
        this.ackMapper = ackMapper;
        this.mentionMapper = mentionMapper;
        this.messageMapper = messageMapper;
        this.authorizationService = authorizationService;
        this.eventPublisher = eventPublisher;
        this.userService = userService;
    }

    /** 保留既有测试构造方式。 */
    public GroupChatMessageAckService(ByaiGroupChatMessageAckMapper ackMapper,
        ByaiGroupChatMentionMapper mentionMapper, ByaiMessageMapper messageMapper,
        GroupChatAuthorizationService authorizationService, GroupChatEventPublisher eventPublisher) {
        this(ackMapper, mentionMapper, messageMapper, authorizationService, eventPublisher, null);
    }

    @Transactional
    public JSONObject acknowledge(Long sessionId, Long messageId) {
        AckTarget target = requireAckTarget(sessionId, messageId);
        Long userId = target.userId();
        ByaiGroupChatMessageAck ack = new ByaiGroupChatMessageAck();
        ack.setSessionId(sessionId);
        ack.setMessageId(messageId);
        ack.setUserId(userId);
        ack.setUserName(resolveUserName(userId, target.member()));
        ack.setAcknowledgedAt(new Date());
        ackMapper.insertIfAbsent(ack);
        return publishUpdatedAcknowledgements(sessionId, messageId, userId);
    }

    @Transactional
    public JSONObject unacknowledge(Long sessionId, Long messageId) {
        AckTarget target = requireAckTarget(sessionId, messageId);
        ackMapper.deleteByMessageAndUser(sessionId, messageId, target.userId());
        return publishUpdatedAcknowledgements(sessionId, messageId, null);
    }

    private JSONObject publishUpdatedAcknowledgements(Long sessionId, Long messageId, Long acknowledgedUserId) {
        List<ByaiGroupChatMessageAck> acks = ackMapper.selectByMessageIds(sessionId, List.of(messageId));
        Map<Long, String> userNames = resolveUserNames(acks.stream().map(ByaiGroupChatMessageAck::getUserId).toList());
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "MESSAGE_ACK_UPDATED");
        event.put("sessionId", String.valueOf(sessionId));
        event.put("messageId", String.valueOf(messageId));
        JSONArray all = new JSONArray();
        acks.forEach(item -> all.add(toJson(item, resolvedUserName(userNames, item.getUserId()))));
        event.put("acknowledgements", all);
        if (acknowledgedUserId != null) {
            acks.stream().filter(item -> acknowledgedUserId.equals(item.getUserId())).findFirst()
                .ifPresent(item -> event.put("acknowledgedBy",
                    toJson(item, resolvedUserName(userNames, item.getUserId()))));
        }
        publishAfterCommit(sessionId, event);
        return event;
    }

    private AckTarget requireAckTarget(Long sessionId, Long messageId) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        authorizationService.requireGroup(sessionId);
        ByaiSessionMember member = authorizationService.requireCurrentUserMember(sessionId);
        ByaiMessage message = messageMapper.selectByMessageId(messageId);
        if (message == null || !sessionId.equals(message.getSessionId()) || message.isRecalled()) {
            throw new IllegalArgumentException("Message cannot be acknowledged");
        }
        if (!MemObjType.USER.name().equals(member.getMemObjType())
            || userId == null || userId.equals(message.getCreatorId())
            || !mentionMapper.existsUserMention(sessionId, messageId, userId)) {
            throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.FORBIDDEN, "Only mentioned users can acknowledge this message");
        }
        return new AckTarget(userId, member);
    }

    private void publishAfterCommit(Long sessionId, JSONObject event) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            eventPublisher.publish(sessionId, event, null);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                eventPublisher.publish(sessionId, event, null);
            }
        });
    }

    private String resolveUserName(Long userId, ByaiSessionMember member) {
        LoginInfo login = CurrentUserHolder.getLoginInfo();
        if (login != null && userId != null && userId.equals(login.getUserId())
            && login.getUserName() != null && !login.getUserName().isBlank()) return login.getUserName();
        if (userId != null) {
            try {
                ShareBfmUser cached = ShareCacheUtil.getShareBfmUser(userId);
                if (cached != null && cached.getUserName() != null && !cached.getUserName().isBlank()) {
                    return cached.getUserName();
                }
            }
            catch (RuntimeException ignored) {
                // Redis 不可用时回退用户表，不阻断“收到”确认。
            }
        }
        if (userService != null && userId != null) {
            Users user = userService.findById(userId);
            if (user != null && user.getUserName() != null && !user.getUserName().isBlank()) return user.getUserName();
        }
        if (member != null && member.getMemName() != null && !member.getMemName().isBlank()
            && !member.getMemName().equals(String.valueOf(userId))) return member.getMemName();
        return "群成员";
    }

    private Map<Long, String> resolveUserNames(List<Long> userIds) {
        Map<Long, String> names = new HashMap<>();
        LoginInfo login = CurrentUserHolder.getLoginInfo();
        List<Long> missing = userIds.stream().filter(Objects::nonNull).distinct().filter(userId -> {
            if (login != null && userId.equals(login.getUserId())
                && login.getUserName() != null && !login.getUserName().isBlank()) {
                names.put(userId, login.getUserName());
                return false;
            }
            try {
                ShareBfmUser cached = ShareCacheUtil.getShareBfmUser(userId);
                if (cached != null && cached.getUserName() != null && !cached.getUserName().isBlank()) {
                    names.put(userId, cached.getUserName());
                    return false;
                }
            }
            catch (RuntimeException ignored) {
                // Redis 不可用或缓存异常时批量回退数据库。
            }
            return true;
        }).toList();
        if (userService != null && !missing.isEmpty()) {
            userService.findByIds(missing).stream()
                .filter(user -> user.getUserId() != null && user.getUserName() != null && !user.getUserName().isBlank())
                .forEach(user -> names.put(user.getUserId(), user.getUserName()));
        }
        return names;
    }

    private String resolvedUserName(Map<Long, String> userNames, Long userId) {
        String userName = userNames.get(userId);
        return userName == null || userName.isBlank() ? "群成员" : userName;
    }

    private JSONObject toJson(ByaiGroupChatMessageAck ack, String userName) {
        JSONObject result = new JSONObject();
        result.put("messageId", String.valueOf(ack.getMessageId()));
        result.put("userId", String.valueOf(ack.getUserId()));
        result.put("userName", userName);
        result.put("acknowledgedAt", ack.getAcknowledgedAt() == null ? null : ack.getAcknowledgedAt().getTime());
        return result;
    }

    private record AckTarget(Long userId, ByaiSessionMember member) {}
}
