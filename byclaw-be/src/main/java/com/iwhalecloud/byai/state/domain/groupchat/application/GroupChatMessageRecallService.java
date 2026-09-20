package com.iwhalecloud.byai.state.domain.groupchat.application;

import lombok.extern.slf4j.Slf4j;

import java.util.Date;
import java.util.Objects;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatRecallProjection;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.enums.UserRole;

/** 撤回仅更新原消息状态，不创建系统消息、不修改话题或关联任务。 */
@Slf4j
@Service
public class GroupChatMessageRecallService {
    private final GroupChatAuthorizationService authorization;
    private final GroupChatTopicService topics;
    private final ByaiMessageMapper messages;
    private final GroupChatEventPublisher events;

    public GroupChatMessageRecallService(GroupChatAuthorizationService authorization, GroupChatTopicService topics,
        ByaiMessageMapper messages, GroupChatEventPublisher events) {
        this.authorization = authorization;
        this.topics = topics;
        this.messages = messages;
        this.events = events;
    }

    @Transactional
    public JSONObject recall(Long sessionId, Long messageId) {
        authorization.requireCurrentUserMember(sessionId);
        topics.lockGroup(sessionId);
        ByaiSessionMember member = authorization.requireCurrentUserMember(sessionId);
        Long userId = CurrentUserHolder.getCurrentUserId();
        ByaiMessage message = messages.selectForRecall(sessionId, messageId);
        if (message == null || !Objects.equals(sessionId, message.getSessionId()) || message.getArchivedAt() != null) {
            throw new IllegalArgumentException("Group message not found");
        }
        if (!Integer.valueOf(1).equals(message.getUsage()) && !Integer.valueOf(2).equals(message.getUsage())) {
            throw new IllegalArgumentException("System messages cannot be recalled");
        }
        boolean administrator = UserRole.OWNER.name().equals(member.getUserRole())
            || UserRole.ADMIN.name().equals(member.getUserRole());
        boolean author = Integer.valueOf(1).equals(message.getUsage()) && Objects.equals(userId, message.getCreatorId());
        if (userId == null || (!administrator && !author)) {
            throw new IllegalArgumentException("Only the author or group administrator can recall this message");
        }
        if (message.isRecalled()) return response(message);
        Date now = new Date();
        if (messages.recallGroupMessage(sessionId, messageId, userId, now) != 1) {
            throw new IllegalStateException("Group message recall was not persisted");
        }
        message.setRecalledAt(now);
        message.setRecalledBy(userId);
        JSONObject result = response(message);
        JSONObject event = new JSONObject();
        event.putAll(result);
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "MESSAGE_RECALLED");
        // 只有数据库提交成功后才能更新在线设备；失败时可通过重新查询恢复。
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    events.publish(sessionId, event, null);
                }
                catch (RuntimeException error) {
                    log.warn("撤回已提交但广播失败, sessionId={}, messageId={}", sessionId, messageId, error);
                }
            }
        });
        return result;
    }

    private JSONObject response(ByaiMessage message) {
        GroupChatRecallProjection projection = new GroupChatRecallProjection();
        JSONObject result = new JSONObject();
        result.put("sessionId", String.valueOf(message.getSessionId()));
        result.put("messageId", String.valueOf(message.getMessageId()));
        result.put("recalled", true);
        result.put("recall", projection.recall(message.getRecalledAt(), message.getRecalledBy()));
        result.put("content", projection.content(message.getRecalledBy()));
        return result;
    }
}
