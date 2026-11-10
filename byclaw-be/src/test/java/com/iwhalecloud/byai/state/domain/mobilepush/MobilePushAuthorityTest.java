package com.iwhalecloud.byai.state.domain.mobilepush;

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

class MobilePushAuthorityTest {
    @Test
    void sharedDataRechecksEnterpriseMembershipReadPositionAndRecall() {
        TenantModeService modes = mock(TenantModeService.class);
        SessionService sessions = mock(SessionService.class);
        SessionMemberService members = mock(SessionMemberService.class);
        ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
        var authority = new MobilePushAuthority(modes, mock(TenantNodeClient.class), sessions, members, messages);
        var notification = new PushNotification("a".repeat(64), 1, 30, 40, 22, "installation-test-device", 1);
        ByaiSession group = new ByaiSession();
        group.setEnterpriseId(1L);
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
        when(members.findSessionMember(30L, "USER", 22L)).thenReturn(null);
        assertThat(authority.allowed(notification)).isFalse();
    }
}
