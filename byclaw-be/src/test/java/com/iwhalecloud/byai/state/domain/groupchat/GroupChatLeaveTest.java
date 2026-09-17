package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Date;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatSettingsService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.test.util.ReflectionTestUtils;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

class GroupChatLeaveTest {
    private final SessionService sessions = mock(SessionService.class);
    private final SessionMemberService members = mock(SessionMemberService.class);
    private final GroupChatAuthorizationService authorization = mock(GroupChatAuthorizationService.class);
    private final GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
    private final SessionExtService extensions = mock(SessionExtService.class);
    private final GroupChatSettingsService settings = mock(GroupChatSettingsService.class);
    private final GroupChatApplicationService service = new GroupChatApplicationService(
        sessions, mock(SequenceService.class), authorization, members, null, null, null, null, events, extensions);

    @BeforeEach
    void setUp() {
        TransactionSynchronizationManager.initSynchronization();
        ReflectionTestUtils.setField(service, "settingsService", settings);
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.clearSynchronization();
    }

    @Test
    void ordinaryMemberLeavesWithoutTransferringOwnership() {
        when(authorization.requireCurrentUserMember(100L)).thenReturn(member(1L, "USER", "MEMBER"));
        service.leave(100L);
        verify(sessions).lockById(100L);
        verify(members).deleteMember(1L);
        verify(members, never()).updateById(any());
        verify(events, never()).publish(any(), any(), any());
        TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCommit());
        verify(events).publish(eq(100L), any(), isNull());
    }

    @Test
    void ownerTransfersToFirstOtherHumanInRoleOrder() {
        ByaiSessionMember owner = member(1L, "USER", "OWNER");
        when(authorization.requireCurrentUserMember(100L)).thenReturn(owner);
        when(members.findOrderedGroupMembers(100L)).thenReturn(List.of(
            owner, member(3L, "USER", "ADMIN"), member(2L, "USER", "MEMBER"), member(4L, "AGENT", "MEMBER")));
        service.leave(100L);
        ArgumentCaptor<ByaiSessionMember> update = ArgumentCaptor.forClass(ByaiSessionMember.class);
        verify(members).updateById(update.capture());
        assertThat(update.getValue().getByaiSessionMemberId()).isEqualTo(3L);
        assertThat(update.getValue().getUserRole()).isEqualTo("OWNER");
        verify(members).deleteMember(1L);
        verify(events, never()).publish(any(), any(), any());
        TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCommit());
        ArgumentCaptor<com.alibaba.fastjson.JSONObject> notifications =
            ArgumentCaptor.forClass(com.alibaba.fastjson.JSONObject.class);
        verify(events, org.mockito.Mockito.times(2)).publish(eq(100L), notifications.capture(), isNull());
        assertThat(notifications.getAllValues().get(1).getString("event")).isEqualTo("OWNERSHIP_TRANSFERRED");
        assertThat(notifications.getAllValues().get(1).getString("recipientUserId")).isEqualTo("3");
    }

    @Test
    void ownerCanTransferToOrdinaryHumanMember() {
        ByaiSessionMember owner = member(1L, "USER", "OWNER");
        when(authorization.requireCurrentUserMember(100L)).thenReturn(owner);
        when(members.findOrderedGroupMembers(100L)).thenReturn(List.of(
            owner, member(2L, "USER", "MEMBER")));
        service.leave(100L);
        ArgumentCaptor<ByaiSessionMember> update = ArgumentCaptor.forClass(ByaiSessionMember.class);
        verify(members).updateById(update.capture());
        assertThat(update.getValue().getByaiSessionMemberId()).isEqualTo(2L);
        assertThat(update.getValue().getUserRole()).isEqualTo("OWNER");
    }

    @Test
    void lastHumanOwnerAutomaticallyDissolvesTheGroup() {
        ByaiSessionMember owner = member(1L, "USER", "OWNER");
        when(authorization.requireCurrentUserMember(100L)).thenReturn(owner);
        when(members.findOrderedGroupMembers(100L)).thenReturn(List.of(owner, member(2L, "AGENT", "MEMBER")));
        service.leave(100L);
        verify(settings).dissolve(100L);
        verify(members, never()).deleteMember(any());
        verify(members, never()).updateById(any());
        assertThat(TransactionSynchronizationManager.getSynchronizations()).isEmpty();
    }

    @Test
    void administratorAppointmentOrderTakesPriorityOverJoinOrder() {
        ByaiSessionMember owner = member(1L, "USER", "OWNER");
        ByaiSessionMember earlierJoin = member(2L, "USER", "ADMIN");
        ByaiSessionMember earlierAdmin = member(3L, "USER", "ADMIN");
        earlierJoin.setCreateTime(new Date(10));
        earlierAdmin.setCreateTime(new Date(20));
        when(authorization.requireCurrentUserMember(100L)).thenReturn(owner);
        when(members.findOrderedGroupMembers(100L)).thenReturn(List.of(owner, earlierJoin, earlierAdmin));
        when(extensions.findOneByExtParamCode(100L, "group_admin_since_2")).thenReturn(appointment("200"));
        when(extensions.findOneByExtParamCode(100L, "group_admin_since_3")).thenReturn(appointment("100"));
        service.leave(100L);
        ArgumentCaptor<ByaiSessionMember> update = ArgumentCaptor.forClass(ByaiSessionMember.class);
        verify(members).updateById(update.capture());
        assertThat(update.getValue().getByaiSessionMemberId()).isEqualTo(3L);
    }

    @Test
    void ordinaryMembersAreSelectedByJoinTimeRatherThanRecordId() {
        ByaiSessionMember owner = member(1L, "USER", "OWNER");
        ByaiSessionMember later = member(2L, "USER", "MEMBER");
        ByaiSessionMember earlier = member(3L, "USER", "MEMBER");
        later.setCreateTime(new Date(200));
        earlier.setCreateTime(new Date(100));
        when(authorization.requireCurrentUserMember(100L)).thenReturn(owner);
        when(members.findOrderedGroupMembers(100L)).thenReturn(List.of(owner, later, earlier));
        service.leave(100L);
        ArgumentCaptor<ByaiSessionMember> update = ArgumentCaptor.forClass(ByaiSessionMember.class);
        verify(members).updateById(update.capture());
        assertThat(update.getValue().getByaiSessionMemberId()).isEqualTo(3L);
    }

    @Test
    void promotingMemberRecordsAppointmentAndRepeatedPromotionDoesNotResetIt() {
        ByaiSessionMember target = member(2L, "USER", "MEMBER");
        when(members.findSessionMember(100L, "USER", 2L)).thenReturn(target);
        service.changeRole(100L, "USER", 2L, "ADMIN");
        service.changeRole(100L, "USER", 2L, "ADMIN");
        ArgumentCaptor<ByaiSessionExt> saved = ArgumentCaptor.forClass(ByaiSessionExt.class);
        verify(extensions).save(saved.capture());
        assertThat(saved.getValue().getExtParamCode()).isEqualTo("group_admin_since_2");
        assertThat(Long.parseLong(saved.getValue().getExtParamValue())).isPositive();
    }

    private ByaiSessionExt appointment(String time) {
        ByaiSessionExt ext = new ByaiSessionExt();
        ext.setExtParamValue(time);
        return ext;
    }

    private ByaiSessionMember member(Long id, String type, String role) {
        ByaiSessionMember member = new ByaiSessionMember();
        member.setByaiSessionMemberId(id);
        member.setMemObjId(id);
        member.setMemObjType(type);
        member.setUserRole(role);
        return member;
    }
}
