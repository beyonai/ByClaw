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
    void missingNodeMemberRecordIdFailsExplicitlyWithoutPublishing() throws Exception {
        var publisher = mock(com.iwhalecloud.byai.common.hook.HookPublisher.class);
        var hooks = new com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.MemberJoinedHook(publisher);
        var result = mock(TenantNodeModels.CommandResult.class);
        when(result.data()).thenReturn(new ObjectMapper().readTree("""
            {"savedMembers":[{"groupId":"30","enterpriseId":"10","userId":"20","invitedBy":"40"}]}
            """));
        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
            TenantGroupMembershipEvents.joined(hooks, new TenantRequestContext(77L, 10L, "MEMBER"), "30", result))
            .isInstanceOf(IllegalStateException.class).hasMessage("groupchat.member.id.unconfirmed");
        verifyNoInteractions(publisher);
    }

    @Test
    void joinedHooksUseOnlyNewHumanMembershipFactsAndKeepOriginalInviter() throws Exception {
        var hooks = mock(com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.MemberJoinedHook.class);
        var result = mock(TenantNodeModels.CommandResult.class);
        when(result.data()).thenReturn(new ObjectMapper().readTree("""
            {"savedMembers":[
              {"groupId":"30","enterpriseId":"10","userId":"9007199254740995","invitedBy":"40","byaiSessionMemberId":"9007199254740996"},
              {"groupId":"30","enterpriseId":"10","userId":"9007199254740995","invitedBy":"40","byaiSessionMemberId":"9007199254740996"}
            ]}
            """));
        TenantGroupMembershipEvents.joined(hooks, new TenantRequestContext(77L, 10L, "MEMBER"), "30", result);
        verify(hooks).memberJoined("30", 10L, "9007199254740995", "40", "9007199254740996");
        verifyNoMoreInteractions(hooks);
    }

    @Test
    void idempotentJoinWithoutMembershipFactsDoesNotSendHook() throws Exception {
        var hooks = mock(com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.MemberJoinedHook.class);
        var result = mock(TenantNodeModels.CommandResult.class);
        when(result.data()).thenReturn(new ObjectMapper().readTree("{\"systemEvents\":[]}"));
        TenantGroupMembershipEvents.joined(hooks, new TenantRequestContext(77L, 10L, "MEMBER"), "30", result);
        verifyNoInteractions(hooks);
    }
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
