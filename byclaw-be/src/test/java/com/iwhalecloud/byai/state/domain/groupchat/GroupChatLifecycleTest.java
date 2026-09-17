package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.ArgumentMatchers.any;
import org.mockito.ArgumentCaptor;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatSettingsService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

class GroupChatLifecycleTest {
    private final SessionService sessions = mock(SessionService.class);
    private final SessionMemberService members = mock(SessionMemberService.class);
    private final SessionExtService extensions = mock(SessionExtService.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final GroupChatSettingsService service = new GroupChatSettingsService(
        sessions, extensions, members, null, sequence, null, null, null);
    private ByaiSession group;

    @BeforeEach
    void setUp() {
        LoginInfo login = new LoginInfo();
        login.setUserId(1L);
        CurrentUserHolder.setLoginInfo(login);
        group = new ByaiSession();
        group.setSessionType(SessionType.HS_AS.getCode());
        when(sessions.findById(7L)).thenReturn(group);
        when(members.findSessionMember(7L, "USER", 1L)).thenReturn(new ByaiSessionMember());
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void retainedMemberCanDistinguishActiveAndDissolvedGroups() {
        assertThat(service.isDissolved(7L)).isFalse();
        group.setState(GroupChatAuthorizationService.DISSOLVED_STATE);
        assertThat(service.isDissolved(7L)).isTrue();
    }

    @Test
    void nonMemberCannotReadDissolvedStatus() {
        group.setState(GroupChatAuthorizationService.DISSOLVED_STATE);
        when(members.findSessionMember(7L, "USER", 1L)).thenReturn(null);
        assertThatThrownBy(() -> service.isDissolved(7L)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void missingGroupIsNotReportedAsDissolved() {
        when(sessions.findById(7L)).thenReturn(null);
        assertThatThrownBy(() -> service.isDissolved(7L)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void anonymousUserCannotReadLifecycle() {
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> service.isDissolved(7L)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test
    void acknowledgmentIsScopedToCurrentUserAndRetainsMembership() {
        group.setState(GroupChatAuthorizationService.DISSOLVED_STATE);
        service.acknowledgeDissolution(7L);
        ArgumentCaptor<ByaiSessionExt> saved = ArgumentCaptor.forClass(ByaiSessionExt.class);
        verify(extensions).save(saved.capture());
        assertThat(saved.getValue().getSessionId()).isEqualTo(7L);
        assertThat(saved.getValue().getExtParamCode()).isEqualTo("group_dissolution_ack_1");
        assertThat(saved.getValue().getExtParamValue()).isEqualTo("true");
        verify(members, never()).deleteMember(any());
    }

    @Test
    void activeGroupCannotBeAcknowledgedAsDissolved() {
        assertThatThrownBy(() -> service.acknowledgeDissolution(7L)).isInstanceOf(IllegalArgumentException.class);
        verify(extensions, never()).save(any());
    }

    @Test
    void nonMemberCannotAcknowledgeAnotherGroupsDissolution() {
        group.setState(GroupChatAuthorizationService.DISSOLVED_STATE);
        when(members.findSessionMember(7L, "USER", 1L)).thenReturn(null);
        assertThatThrownBy(() -> service.acknowledgeDissolution(7L)).isInstanceOf(IllegalArgumentException.class);
        verify(extensions, never()).save(any());
    }
}
