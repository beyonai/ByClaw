package com.iwhalecloud.byai.manager.domain.tenant;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Broadcast only the membership facts and system messages committed by the Node. */
final class TenantGroupMembershipEvents {
    private TenantGroupMembershipEvents() {}

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
