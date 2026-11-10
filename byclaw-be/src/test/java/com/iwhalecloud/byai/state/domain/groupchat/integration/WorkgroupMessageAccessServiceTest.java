package com.iwhalecloud.byai.state.domain.groupchat.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.tenant.TenantModeService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import org.junit.jupiter.api.Test;

class WorkgroupMessageAccessServiceTest {
    @Test
    void sharedDataRechecksEnterpriseMembershipReadPositionAndRecall() {
        TenantModeService modes = mock(TenantModeService.class);
        SessionService sessions = mock(SessionService.class);
        SessionMemberService members = mock(SessionMemberService.class);
        ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
        var authority = new WorkgroupMessageAccessService(modes, mock(TenantNodeClient.class), sessions, members, messages);
        var notification = new WorkgroupMessageQuery(1, 30, 40, 22);
        ByaiSession group = new ByaiSession();
        group.setEnterpriseId(1L);
        group.setSessionType(com.iwhalecloud.byai.state.domain.session.enums.SessionType.HS_AS.getCode());
        ByaiSessionMember member = new ByaiSessionMember();
        ByaiMessage message = new ByaiMessage();
        message.setSessionId(30L);
        message.setIsComplete(true);
        when(modes.isSharedDataTenant(1)).thenReturn(true);
        when(sessions.findById(30L)).thenReturn(group);
        when(members.findSessionMember(30L, "USER", 22L)).thenReturn(member);
        when(messages.selectByMessageId(40L)).thenReturn(message);
        assertThat(authority.allowed(notification)).isTrue();
        member.setLastReadMessageId(40L);
        assertThat(authority.allowed(notification)).isFalse();
        member.setLastReadMessageId(null);
        message.setRecalledAt(new java.util.Date());
        assertThat(authority.allowed(notification)).isFalse();
        message.setRecalledAt(null);
        group.setEnterpriseId(2L);
        assertThat(authority.allowed(notification)).isFalse();
        group.setEnterpriseId(1L);
        group.setSessionType(com.iwhalecloud.byai.state.domain.session.enums.SessionType.HS_AS.getCode());
        when(members.findSessionMember(30L, "USER", 22L)).thenReturn(null);
        assertThat(authority.allowed(notification)).isFalse();
    }
    @Test
    void tenantReadPositionIsRecheckedAndOnlyExactHumanResourcesCountAsMentions() throws Exception {
        var modes = mock(TenantModeService.class);
        var node = mock(TenantNodeClient.class);
        var sessions = mock(SessionService.class);
        var members = mock(SessionMemberService.class);
        var messages = mock(ByaiMessageMapper.class);
        var authority = new WorkgroupMessageAccessService(modes, node, sessions, members, messages);
        var notification = new WorkgroupMessageQuery(10, 30, 40, 22);
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        org.mockito.Mockito.doReturn(json.readTree("{\"members\":[{\"memObjType\":\"USER\",\"memObjId\":\"22\",\"lastReadMessageId\":\"40\"}]}"))
            .when(node).request(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("GET"),
                org.mockito.ArgumentMatchers.eq("/internal/v1/group-chats/30"), org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.any());
        assertThat(authority.allowed(notification)).isFalse();
        when(modes.isSharedDataTenant(10)).thenReturn(true);
        var message = new ByaiMessage();
        message.setMetadata("{\"resourceList\":[{\"resourceType\":\"DIG_EMPLOYEE\",\"resourceId\":\"22\"}]}");
        when(messages.selectByMessageId(40L)).thenReturn(message);
        assertThat(authority.mentioned(notification)).isFalse();
        message.setMetadata("{\"resourceList\":[{\"resourceType\":\"HUMAN\",\"resourceId\":\"22\"}]}");
        assertThat(authority.mentioned(notification)).isTrue();
    }

    @Test
    void tenantIncompleteAndRecalledMessagesAreNeverAllowed() throws Exception {
        var node = mock(TenantNodeClient.class);
        var service = new WorkgroupMessageAccessService(mock(TenantModeService.class), node,
            mock(SessionService.class), mock(SessionMemberService.class), mock(ByaiMessageMapper.class));
        var query = new WorkgroupMessageQuery(10, 30, 40, 22);
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        org.mockito.Mockito.doReturn(json.readTree("{\"members\":[{\"memObjType\":\"USER\",\"memObjId\":\"22\",\"lastReadMessageId\":\"39\"}]}"))
            .when(node).request(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("GET"),
                org.mockito.ArgumentMatchers.eq("/internal/v1/group-chats/30"), org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.any());
        for (String fields : new String[] {"", ",\"complete\":false", ",\"complete\":true,\"recalled\":true"}) {
            org.mockito.Mockito.doReturn(json.readTree("{\"messages\":[{\"messageId\":\"40\"" + fields + "}]}"))
                .when(node).request(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("GET"),
                    org.mockito.ArgumentMatchers.eq("/internal/v1/group-chats/30/messages/40/context"), org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.any());
            assertThat(service.allowed(query)).isFalse();
        }
        org.mockito.Mockito.doReturn(json.readTree("{\"messages\":[{\"messageId\":\"40\",\"complete\":true,\"recalled\":false}]}"))
            .when(node).request(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("GET"),
                org.mockito.ArgumentMatchers.eq("/internal/v1/group-chats/30/messages/40/context"), org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.any());
        assertThat(service.allowed(query)).isTrue();
    }

}
