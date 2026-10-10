package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatStatusRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.RunningChatSnapshotService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.interfaces.controller.chat.AssistantChatController;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

class TenantChatRuntimeRoutingAspectTest {
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final RunningOutputStreamRegistry running = mock(RunningOutputStreamRegistry.class);
    private final RunningChatSnapshotService snapshots = mock(RunningChatSnapshotService.class);
    private final AssistantChatApplicationService chat = mock(AssistantChatApplicationService.class);
    private final SessionService personalSessions = mock(SessionService.class);
    private final TenantRequestContext context = new TenantRequestContext(8L, 123L, "MEMBER");

    private AssistantChatController controller() {
        AssistantChatController target = new AssistantChatController();
        ReflectionTestUtils.setField(target, "sessionService", personalSessions);
        ReflectionTestUtils.setField(target, "runningOutputStreamRegistry", running);
        ReflectionTestUtils.setField(target, "runningChatSnapshotService", snapshots);
        ReflectionTestUtils.setField(target, "assistantChatApplicationService", chat);
        AspectJProxyFactory factory = new AspectJProxyFactory(target);
        factory.addAspect(new TenantChatRuntimeRoutingAspect(node, running, snapshots, chat));
        return factory.getProxy();
    }

    @AfterEach
    void clear() {
        TenantRequestContextHolder.clear();
    }

    @Test
    void tenantCanEditPendingAnswerOnlyAfterItsSessionIsAuthorized() {
        TenantRequestContextHolder.set(context);
        var request = new com.iwhalecloud.byai.state.common.dto.MessageStructDto();
        request.setSessionId(456L);
        request.setMessageId(789L);
        request.setUpdateField("messageStruct");
        request.setId("segment");
        request.setContent("edited");
        when(node.request(eq(context), eq("POST"), eq("/internal/v1/assiman/getMessageByIds"), any(), any()))
            .thenReturn(List.of());
        var updated = new com.iwhalecloud.byai.common.message.entity.ByaiMessage();
        updated.setMessageId(789L);
        when(chat.updateRunningSnapshotMessageStructInSession(request)).thenReturn(updated);
        assertThat(controller().updateMessageStructById(request).getData()).isSameAs(updated);
        org.mockito.Mockito.verify(node).request(eq(context), eq("GET"), eq("/internal/v1/sessions/456"), any(), any());
        org.mockito.Mockito.verify(node, org.mockito.Mockito.never()).command(any(), any(), any(), any(), any(), any());
        verifyNoInteractions(personalSessions);
    }

    @Test
    void pendingAnswerInForeignSessionCannotBeEdited() {
        TenantRequestContextHolder.set(context);
        var request = new com.iwhalecloud.byai.state.common.dto.MessageStructDto();
        request.setSessionId(456L);
        request.setMessageId(789L);
        request.setUpdateField("messageStruct");
        request.setId("segment");
        request.setContent("edited");
        when(node.request(eq(context), eq("POST"), eq("/internal/v1/assiman/getMessageByIds"), any(), any()))
            .thenReturn(List.of());
        when(node.request(eq(context), eq("GET"), eq("/internal/v1/sessions/456"), any(), any()))
            .thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN));
        assertThatThrownBy(() -> controller().updateMessageStructById(request)).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(chat, snapshots, personalSessions);
    }

    @Test
    void tenantRuntimeListFiltersForeignSessionsWithoutConsultingThePersonalDatabase() {
        TenantRequestContextHolder.set(context);
        when(node.request(eq(context), eq("GET"), eq("/internal/v1/sessions/457"), any(), any()))
            .thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN));
        RunningChatInfo info = new RunningChatInfo();
        info.setSessionId(456L);
        when(running.getRunning(456L)).thenReturn(info);
        RunningChatStatusRequest request = new RunningChatStatusRequest();
        request.setSessionIds(List.of(456L, 457L));
        assertThat(controller().runningStatus(request).getData()).containsExactly(info);
        verifyNoInteractions(personalSessions);
    }

    @Test
    void authorizedTenantCanRecoverItsRunningSnapshot() {
        TenantRequestContextHolder.set(context);
        RunningChatSnapshotRequest request = new RunningChatSnapshotRequest();
        request.setSessionId(456L);
        RunningChatSnapshotResponse snapshot = new RunningChatSnapshotResponse();
        snapshot.setSessionId(456L);
        when(snapshots.get(456L, null, null)).thenReturn(snapshot);
        assertThat(controller().runningSnapshot(request).getData()).isSameAs(snapshot);
        verifyNoInteractions(personalSessions);
    }

    @Test
    void foreignTenantCannotCancelOrReadARunningSession() {
        TenantRequestContextHolder.set(context);
        when(node.request(eq(context), eq("GET"), eq("/internal/v1/sessions/456"), any(), any()))
            .thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN));
        StopChatDto request = new StopChatDto();
        request.setSessionId(456L);
        assertThatThrownBy(() -> controller().stopChat(null, request)).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(chat, snapshots, running, personalSessions);
    }

    @Test
    void personalRuntimeListStillUsesTheOriginalHandler() {
        RunningChatStatusRequest request = new RunningChatStatusRequest();
        request.setSessionIds(List.of(456L));
        when(personalSessions.findBatchByIds(List.of(456L))).thenReturn(List.of());
        assertThat(controller().runningStatus(request).getData()).isEmpty();
        verifyNoInteractions(node);
    }
}
