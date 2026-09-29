package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskChatGuard;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.resource.bo.AuthContextBo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;

class GroupChatTaskAgentHandoffTest {
    private final ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);
    private final GroupChatAuthorizationService groups = mock(GroupChatAuthorizationService.class);
    private final SessionMemberService members = mock(SessionMemberService.class);
    private final ResourceAuthContextService permissions = mock(ResourceAuthContextService.class);
    private final SsResourceService resources = mock(SsResourceService.class);
    private final GroupChatTaskService lifecycle = mock(GroupChatTaskService.class);
    private final GroupChatTaskAuthorizationService authorization = new GroupChatTaskAuthorizationService(
        tasks, groups, members, permissions, resources);
    private final RunningOutputStreamRegistry running = mock(RunningOutputStreamRegistry.class);
    private final GroupChatTaskChatGuard guard = new GroupChatTaskChatGuard(tasks, authorization, lifecycle, running);
    private ByaiGroupChatTask task;

    @BeforeEach
    void setUp() {
        LoginInfo login = new LoginInfo();
        login.setUserId(30L);
        CurrentUserHolder.setLoginInfo(login);
        task = new ByaiGroupChatTask();
        task.setTaskSessionId(60L);
        task.setGroupSessionId(10L);
        task.setInitiatorUserId(30L);
        task.setTargetAgentId(40L);
        task.setStatus("ACTIVE");
        when(tasks.selectById(60L)).thenReturn(task);
        when(members.findSessionMember(10L, "AGENT", 41L)).thenReturn(new ByaiSessionMember());
        when(resources.findById(41L)).thenReturn(new SsResource());
        when(permissions.getAuthContextBo()).thenReturn(new AuthContextBo(Set.of(41L), Map.of()));
        when(lifecycle.startTurn(60L)).thenReturn(101L);
    }

    @AfterEach
    void clearUser() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void authorizedMemberCanTakeOverWithoutChangingTaskOwner() {
        assertThat(guard.beforeTurn(60L, 41L, null)).isEqualTo(101L);
        assertThat(task.getTargetAgentId()).isEqualTo(40L);
        verify(groups).requireCurrentUserMember(10L);
        verify(lifecycle).startTurn(60L);
    }

    @Test
    void nonMemberCannotOccupyTaskTurn() {
        assertThatThrownBy(() -> guard.beforeTurn(60L, 42L, null)).hasMessageContaining("authorized group member");
        verify(lifecycle, never()).startTurn(60L);
    }

    @Test
    void revokedResourcePermissionCannotOccupyTaskTurn() {
        when(permissions.getAuthContextBo()).thenReturn(new AuthContextBo(Set.of(), Map.of()));
        assertThatThrownBy(() -> guard.beforeTurn(60L, 41L, null)).hasMessageContaining("authorized group member");
        verify(lifecycle, never()).startTurn(60L);
    }

    @Test
    void anotherGroupMemberCannotTakeOverPrivateTask() {
        task.setInitiatorUserId(31L);
        assertThatThrownBy(() -> guard.beforeTurn(60L, 41L, null)).hasMessageContaining("Only task initiator");
        verify(lifecycle, never()).startTurn(60L);
    }

    @Test
    void terminalTaskAndConcurrentTurnAreRejected() {
        task.setStatus("PUBLISHED");
        assertThatThrownBy(() -> guard.beforeTurn(60L, 41L, null)).hasMessageContaining("does not accept");
        verify(lifecycle, never()).startTurn(60L);
        task.setStatus("ACTIVE");
        when(lifecycle.startTurn(60L)).thenReturn((Long) null);
        assertThatThrownBy(() -> guard.beforeTurn(60L, 41L, null)).hasMessageContaining("does not accept");
    }

    @Test
    void backgroundResumeDoesNotAcquireOrReplaceTaskTurn() {
        RunningChatInfo background = new RunningChatInfo();
        background.setRunning(true);
        background.setTraceId("background-trace");
        when(running.getRunning(60L)).thenReturn(background);
        task.setTurnStatus("WAITING_USER");
        task.setCurrentTurnId(100L);
        task.setCurrentTurnTraceId("background-trace");

        assertThat(guard.beforeTurn(60L, 41L, "background-trace")).isNull();
        assertThat(task.getTurnStatus()).isEqualTo("WAITING_USER");

        task.setTurnStatus("RUNNING");
        task.setCurrentTurnId(101L);
        task.setCurrentTurnTraceId("foreground-trace");
        assertThat(guard.beforeTurn(60L, 41L, "background-trace")).isNull();
        assertThat(task.getCurrentTurnId()).isEqualTo(101L);
        assertThat(task.getCurrentTurnTraceId()).isEqualTo("foreground-trace");
        verify(lifecycle, never()).startTurn(60L);
    }

    @Test
    void staleResumeCannotCreateANewTaskReservation() {
        RunningChatInfo idle = new RunningChatInfo();
        idle.setRunning(false);
        when(running.getRunning(60L)).thenReturn(idle);
        assertThatThrownBy(() -> guard.beforeTurn(60L, 41L, "finished-trace"))
            .hasMessageContaining("no longer running");
        idle.setRunning(true);
        idle.setTraceId("other-trace");
        assertThatThrownBy(() -> guard.beforeTurn(60L, 41L, "finished-trace"))
            .hasMessageContaining("no longer running");
        verify(lifecycle, never()).startTurn(60L);
    }

    @Test
    void preparationFailureReleasesTaskForRetry() {
        guard.beforeTurn(60L, 41L, null);
        guard.failTurnStart(60L, 101L);
        verify(lifecycle).failTurnStart(60L, 101L);
    }

    @Test
    void ordinarySessionDoesNotAcquireTaskSlot() {
        assertThat(guard.beforeTurn(99L, 41L, null)).isNull();
        verify(lifecycle, never()).startTurn(99L);
    }
}
