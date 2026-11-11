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
    /** 真人群昵称与员工实际名称分别投影，不能把员工创建者显示为发言人。 */
    @Test
    void sharedPreviewUsesActualSpeakerAndStopsAfterRecall() {
        var modes = mock(TenantModeService.class);
        var sessions = mock(SessionService.class);
        var members = mock(SessionMemberService.class);
        var messages = mock(ByaiMessageMapper.class);
        var service = new WorkgroupMessageAccessService(modes, mock(TenantNodeClient.class), sessions, members, messages);
        var query = new WorkgroupMessageQuery(1, 30, 40, 22);
        var group = new ByaiSession();
        group.setEnterpriseId(1L);
        group.setSessionType(com.iwhalecloud.byai.state.domain.session.enums.SessionType.HS_AS.getCode());
        group.setSessionName("研发群");
        var receiver = new ByaiSessionMember();
        var sender = new ByaiSessionMember();
        sender.setMemName("群内昵称");
        var message = new ByaiMessage();
        message.setSessionId(30L);
        message.setIsComplete(true);
        message.setCreatorId(77L);
        message.setCreatorName("原始姓名");
        message.setUsage(1);
        message.setMessageContent("下午三点开会");
        when(modes.isSharedDataTenant(1)).thenReturn(true);
        when(sessions.findById(30L)).thenReturn(group);
        when(members.findSessionMember(30L, "USER", 22L)).thenReturn(receiver);
        when(members.findSessionMember(30L, "USER", 77L)).thenReturn(sender);
        when(messages.selectByMessageId(40L)).thenReturn(message);
        assertThat(service.preview(query).getSenderName()).isEqualTo("群内昵称");
        message.setUsage(2);
        message.setCreatorName("工作组助手");
        assertThat(service.preview(query).getSenderName()).isEqualTo("工作组助手");
        assertThat(service.preview(query).getSenderType()).isEqualTo("AGENT");
        var recalled = new ByaiMessage();
        recalled.setSessionId(30L);
        recalled.setIsComplete(true);
        recalled.setRecalledAt(new java.util.Date());
        when(messages.selectByMessageId(40L)).thenReturn(message, recalled);
        assertThat(service.preview(query)).isNull();
        receiver.setLastReadMessageId(40L);
        assertThat(service.preview(query)).isNull();
        when(members.findSessionMember(30L, "USER", 22L)).thenReturn(null);
        assertThat(service.preview(query)).isNull();
    }

    /** 独立租户复用接收人的 Node 读取，只取定位消息，不混入上下文邻居或推理字段。 */
    @Test
    void tenantPreviewUsesTargetPublicContentAndActualAgentName() throws Exception {
        var node = mock(TenantNodeClient.class);
        var service = new WorkgroupMessageAccessService(mock(TenantModeService.class), node,
            mock(SessionService.class), mock(SessionMemberService.class), mock(ByaiMessageMapper.class));
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        org.mockito.Mockito.doReturn(json.readTree("""
            {"session":{"sessionName":"项目组"},"members":[{"memObjType":"USER","memObjId":"22",
              "lastReadMessageId":"39"}]}
            """))
            .when(node).request(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("GET"),
                org.mockito.ArgumentMatchers.eq("/internal/v1/group-chats/30"), org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.any());
        org.mockito.Mockito.doReturn(json.readTree("""
            {"messages":[{"messageId":"39","content":"neighbor"},
             {"messageId":"40","complete":true,"recalled":false,"content":"已完成文档",
              "speaker":{"type":"agent","displayName":"文档助手"},"creatorName":"创建者",
              "inferLog":"private reasoning","attachments":[{"url":"private-url"}]}]}
            """))
            .when(node).request(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("GET"),
                org.mockito.ArgumentMatchers.eq("/internal/v1/group-chats/30/messages/40/context"), org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.any());
        var preview = service.preview(new WorkgroupMessageQuery(10, 30, 40, 22));
        assertThat(preview.getGroupName()).isEqualTo("项目组");
        assertThat(preview.getSenderName()).isEqualTo("文档助手");
        assertThat(preview.getText()).isEqualTo("已完成文档");
        assertThat(preview.isAttachments()).isTrue();
        assertThat(json.valueToTree(preview).toString()).doesNotContain("neighbor", "private reasoning", "private-url", "创建者");
    }

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
