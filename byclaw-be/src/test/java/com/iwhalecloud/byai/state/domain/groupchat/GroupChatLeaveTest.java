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
    private final GroupChatApplicationService service = new GroupChatApplicationService(
        sessions, null, authorization, members, null, null, null, null, events, null);

    @BeforeEach
    void setUp() {
        TransactionSynchronizationManager.initSynchronization();
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
    void lastHumanOwnerMustExplicitlyDissolveInstead() {
        ByaiSessionMember owner = member(1L, "USER", "OWNER");
        when(authorization.requireCurrentUserMember(100L)).thenReturn(owner);
        when(members.findOrderedGroupMembers(100L)).thenReturn(List.of(owner, member(2L, "AGENT", "MEMBER")));
        assertThatThrownBy(() -> service.leave(100L))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("解散工作组");
        verify(members, never()).deleteMember(any());
        verify(members, never()).updateById(any());
        assertThat(TransactionSynchronizationManager.getSynchronizations()).isEmpty();
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
