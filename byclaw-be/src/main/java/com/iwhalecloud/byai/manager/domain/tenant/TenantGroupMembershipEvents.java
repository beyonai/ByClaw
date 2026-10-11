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
        if (result == null || result.data() == null) return;
        var notices = result.data().path("systemEvents");
        if (!notices.isArray() || notices.isEmpty()) return;
        Runnable publish = () -> {
            var membership = new JSONObject();
            membership.put("type", "GROUP_CHAT_EVENT");
            membership.put("event", "MEMBER_ADDED");
            membership.put("sessionId", sessionId.toString());
            events.publishTenant(tenant, sessionId, membership);
            notices.forEach(notice -> events.publishTenant(tenant, sessionId, JSONObject.parseObject(notice.toString())));
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() { publish.run(); }
            });
        } else publish.run();
    }
}
