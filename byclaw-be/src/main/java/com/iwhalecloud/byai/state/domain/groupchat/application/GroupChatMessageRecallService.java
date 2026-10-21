package com.iwhalecloud.byai.state.domain.groupchat.application;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import lombok.extern.slf4j.Slf4j;

import java.util.Date;
import java.util.Objects;
import java.time.Clock;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
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

/** 撤回仅更新原消息状态，不创建系统消息、不修改话题关系；关联执行通过持久化补偿停止。 */
@Slf4j
@Service
public class GroupChatMessageRecallService {
    @Autowired
    private GroupChatRecallCancellationService cancellations;
    private final GroupChatAuthorizationService authorization;
    private final GroupChatTopicService topics;
    private final ByaiMessageMapper messages;
    private final GroupChatEventPublisher events;
    private Clock clock = Clock.systemUTC();

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
            throw new IllegalArgumentException(I18nUtil.get("groupchat.message.notFound"));
        }
        if (!Integer.valueOf(1).equals(message.getUsage()) && !Integer.valueOf(2).equals(message.getUsage())) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.recall.systemDenied"));
        }
        boolean administrator = UserRole.OWNER.name().equals(member.getUserRole())
            || UserRole.ADMIN.name().equals(member.getUserRole());
        boolean author = Integer.valueOf(1).equals(message.getUsage()) && Objects.equals(userId, message.getCreatorId());
        if (userId == null || (!administrator && !author)) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.recall.permissionDenied"));
        }
        if (message.isRecalled()) {
            cancellations.cancel(sessionId, messageId);
            return response(message);
        }
        Date now = nextRecallTime(message);
        if (messages.recallGroupMessage(sessionId, messageId, userId, now) != 1) {
            throw new IllegalStateException(I18nUtil.get("groupchat.recall.saveFailed"));
        }
        message.setRecalledAt(now);
        message.setRecalledBy(userId);
        cancellations.cancel(sessionId, messageId);
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

    /** 与撤回共用群锁；恢复只清除展示标记，持久化停止屏障和任务状态均保留。 */
    @Transactional
    public JSONObject undoRecall(Long sessionId, Long messageId, Long recalledAt) {
        if (recalledAt == null || recalledAt <= 0) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.recallUndo.invalidTime"));
        }
        authorization.requireCurrentUserMember(sessionId);
        topics.lockGroup(sessionId);
        authorization.requireCurrentUserMember(sessionId);
        Long userId = CurrentUserHolder.getCurrentUserId();
        ByaiMessage message = messages.selectForRecall(sessionId, messageId);
        if (message == null || !Objects.equals(sessionId, message.getSessionId()) || message.getArchivedAt() != null
            || (!Integer.valueOf(1).equals(message.getUsage()) && !Integer.valueOf(2).equals(message.getUsage()))) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.message.notFound"));
        }
        // 保留完整业务元数据；损坏数据不能通过恢复操作被静默覆盖。
        JSONObject metadata = JSONObject.parseObject(message.getMetadata());
        if (metadata == null) metadata = new JSONObject();
        if (!message.isRecalled()) {
            JSONObject receipt = metadata.getJSONObject("recallUndo");
            if (receipt == null || !Objects.equals(recalledAt, receipt.getLong("recalledAt"))) {
                throw new IllegalArgumentException(I18nUtil.get("groupchat.recallUndo.conflict"));
            }
            requireRecallOperator(userId, receipt.getString("operatorId"));
            return undoResponse(sessionId, messageId);
        }
        requireRecallOperator(userId, message.getRecalledBy() == null ? null : message.getRecalledBy().toString());
        if (message.getRecalledAt().getTime() != recalledAt) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.recallUndo.conflict"));
        }
        long now = clock.millis();
        if (recalledAt > now || recalledAt < now - 120_000L) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.recallUndo.expired"));
        }
        JSONObject receipt = new JSONObject();
        receipt.put("operatorId", userId.toString());
        receipt.put("recalledAt", recalledAt);
        metadata.put("recallUndo", receipt);
        metadata.remove("recall");
        if (messages.undoRecallGroupMessage(sessionId, messageId, userId, message.getRecalledAt(),
            new Date(now), new Date(now - 120_000L), metadata.toJSONString()) != 1) {
            throw new IllegalStateException(I18nUtil.get("groupchat.recallUndo.saveFailed"));
        }
        message.setRecalledAt(null);
        message.setRecalledBy(null);
        message.setMetadata(metadata.toJSONString());
        JSONObject result = undoResponse(sessionId, messageId);
        JSONObject event = new JSONObject();
        event.putAll(result);
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "MESSAGE_RECALL_UNDONE");
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    events.publish(sessionId, event, null);
                }
                catch (RuntimeException error) {
                    log.warn("撤销撤回已提交但广播失败, sessionId={}, messageId={}", sessionId, messageId, error);
                }
            }
        });
        return result;
    }

    private void requireRecallOperator(Long userId, String operatorId) {
        if (userId == null || !userId.toString().equals(operatorId)) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.recallUndo.permissionDenied"));
        }
    }

    private JSONObject undoResponse(Long sessionId, Long messageId) {
        JSONObject result = new JSONObject();
        result.put("sessionId", sessionId.toString());
        result.put("messageId", messageId.toString());
        result.put("recalled", false);
        result.put("recall", null);
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

    /** 同一毫秒内再次撤回也必须产生新版本，旧的撤销请求不能作用于它。 */
    private Date nextRecallTime(ByaiMessage message) {
        long now = clock.millis();
        try {
            JSONObject metadata = JSONObject.parseObject(message.getMetadata());
            JSONObject receipt = metadata == null ? null : metadata.getJSONObject("recallUndo");
            Long previous = receipt == null ? null : receipt.getLong("recalledAt");
            if (previous != null && previous > 0 && previous < Long.MAX_VALUE) now = Math.max(now, previous + 1);
        }
        catch (RuntimeException ignored) {
            // 历史元数据损坏不应阻止原有撤回功能。
        }
        return new Date(now);
    }
}
