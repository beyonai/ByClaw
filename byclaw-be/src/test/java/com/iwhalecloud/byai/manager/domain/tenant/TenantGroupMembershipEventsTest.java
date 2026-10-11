package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class TenantGroupMembershipEventsTest {
    @Test
    void publishesCommittedNoticeOnlyAfterPlatformTransactionCommits() throws Exception {
        var events = mock(GroupChatEventPublisher.class);
        var tenant = new TenantRequestContext(77L, 10L, "MEMBER");
        var result = mock(TenantNodeModels.CommandResult.class);
        when(result.data()).thenReturn(new ObjectMapper().readTree(
            "{\"systemEvents\":[{\"type\":\"GROUP_CHAT_EVENT\",\"event\":\"MESSAGE_CREATED\",\"messageId\":\"90\",\"kind\":\"SYSTEM_EVENT\"}]}"));
        TransactionSynchronizationManager.initSynchronization();
        try {
            TenantGroupMembershipEvents.publish(events, tenant, 30L, result);
            verifyNoInteractions(events);
            TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCommit());
            var payloads = org.mockito.ArgumentCaptor.forClass(JSONObject.class);
            verify(events, times(2)).publishTenant(eq(tenant), eq(30L), payloads.capture());
            assertThat(payloads.getAllValues()).extracting(value -> value.getString("event"))
                .containsExactly("MEMBER_ADDED", "MESSAGE_CREATED");
            assertThat(payloads.getAllValues().get(1).getString("messageId")).isEqualTo("90");
        } finally { TransactionSynchronizationManager.clearSynchronization(); }
    }

    @Test
    void duplicateJoinWithoutNewNoticesDoesNotBroadcast() throws Exception {
        var events = mock(GroupChatEventPublisher.class);
        var result = mock(TenantNodeModels.CommandResult.class);
        when(result.data()).thenReturn(new ObjectMapper().readTree("{\"systemEvents\":[]}"));
        TenantGroupMembershipEvents.publish(events, new TenantRequestContext(77L, 10L, "MEMBER"), 30L, result);
        verifyNoInteractions(events);
    }
}
