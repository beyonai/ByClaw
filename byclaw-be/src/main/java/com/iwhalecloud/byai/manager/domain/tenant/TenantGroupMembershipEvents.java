package com.iwhalecloud.byai.manager.domain.tenant;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Broadcast only the membership facts and system messages committed by the Node. */
final class TenantGroupMembershipEvents {
    private TenantGroupMembershipEvents() {}

    /** 消费 Node 在成员表实际插入后记录的事实，与邀请及聊天系统消息解耦。 */
    static void joined(com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.MemberJoinedHook hooks,
        TenantRequestContext tenant, String sessionId, TenantNodeModels.CommandResult result) {
        if (result == null || result.data() == null) return;
        var notices = result.data().path("savedMembers");
        if (!notices.isArray()) return;
        var users = new java.util.HashSet<String>();
        for (var notice : notices) {
            if (!sessionId.equals(notice.path("groupId").asText())
                || !Long.toString(tenant.enterpriseId()).equals(notice.path("enterpriseId").asText())) {
                throw new IllegalStateException("groupchat.member.ownership.unconfirmed");
            }
            if (users.add(notice.path("byaiSessionMemberId").asText())) {
                hooks.memberJoined(sessionId, tenant.enterpriseId(), notice.path("userId").asText(),
                    notice.path("invitedBy").asText(), notice.path("byaiSessionMemberId").asText());
            }
        }
    }

    static void publish(GroupChatEventPublisher events, TenantRequestContext tenant, Long sessionId,
        TenantNodeModels.CommandResult result) {
        publish(events, tenant, sessionId, result, "MEMBER_ADDED", null);
    }

    static void publish(GroupChatEventPublisher events, TenantRequestContext tenant, Long sessionId,
        TenantNodeModels.CommandResult result, String membershipEvent, java.util.List<?> previousMembers) {
        if (result == null || result.data() == null) return;
        var notices = result.data().path("systemEvents");
        if (!notices.isArray() || notices.isEmpty()) return;
        Runnable publish = () -> {
            var membership = new JSONObject();
            membership.put("type", "GROUP_CHAT_EVENT");
            membership.put("event", membershipEvent);
            membership.put("sessionId", sessionId.toString());
            java.util.function.Consumer<JSONObject> broadcast = notification -> {
                if (previousMembers == null) events.publishTenant(tenant, sessionId, notification);
                else events.publishTenantMembers(tenant, notification, previousMembers);
            };
            broadcast.accept(membership);
            notices.forEach(notice -> broadcast.accept(JSONObject.parseObject(notice.toString())));
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() { publish.run(); }
            });
        } else publish.run();
    }
}
