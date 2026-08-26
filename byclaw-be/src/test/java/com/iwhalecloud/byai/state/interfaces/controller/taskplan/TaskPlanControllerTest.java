package com.iwhalecloud.byai.state.interfaces.controller.taskplan;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService;
import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService.TaskPlanWriteResult;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanCommandResult;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanUpdateRequest;
import com.iwhalecloud.byai.state.domain.taskplan.exception.TaskPlanCommandException;
import com.iwhalecloud.byai.state.domain.ws.service.TaskPlanWebSocketPublisher;

class TaskPlanControllerTest {

    private TaskPlanApplicationService service;

    private TaskPlanWebSocketPublisher publisher;

    private TaskPlanController controller;

    @BeforeEach
    void setUp() {
        service = mock(TaskPlanApplicationService.class);
        publisher = mock(TaskPlanWebSocketPublisher.class);
        controller = new TaskPlanController(service, publisher);
    }

    @Test
    void changedCommandBroadcastsTheUnchangedFrontendSnapshot() {
        TaskPlanSnapshot snapshot = snapshot();
        when(service.executeCommand(any())).thenReturn(new TaskPlanWriteResult(snapshot, true));

        TaskPlanCommandResult result = controller.update(new TaskPlanUpdateRequest()).getData();

        assertThat(result.isOk()).isTrue();
        assertThat(result.getPlan()).isSameAs(snapshot);
        verify(publisher).broadcast(CurrentUserHolder.getCurrentUserId(), snapshot, null);
    }

    @Test
    void idempotentReplayDoesNotBroadcastTheSameVersionAgain() {
        TaskPlanSnapshot snapshot = snapshot();
        when(service.executeCommand(any())).thenReturn(new TaskPlanWriteResult(snapshot, false));

        TaskPlanCommandResult result = controller.update(new TaskPlanUpdateRequest()).getData();

        assertThat(result.isOk()).isTrue();
        verifyNoInteractions(publisher);
    }

    @Test
    void protocolErrorReturnsMachineReadableResultWithoutBroadcasting() {
        TaskPlanSnapshot current = snapshot();
        when(service.executeCommand(any())).thenThrow(
            new TaskPlanCommandException("VERSION_CONFLICT", "version changed", current));

        TaskPlanCommandResult result = controller.update(new TaskPlanUpdateRequest()).getData();

        assertThat(result.isOk()).isFalse();
        assertThat(result.getError().getCode()).isEqualTo("VERSION_CONFLICT");
        assertThat(result.getCurrentPlan()).isSameAs(current);
        verifyNoInteractions(publisher);
    }

    private TaskPlanSnapshot snapshot() {
        TaskPlanSnapshot snapshot = new TaskPlanSnapshot();
        snapshot.setPlanId("1");
        snapshot.setVersion(2);
        snapshot.setStatus("ACTIVE");
        return snapshot;
    }
}
