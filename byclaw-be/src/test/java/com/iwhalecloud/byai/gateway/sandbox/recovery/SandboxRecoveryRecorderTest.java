package com.iwhalecloud.byai.gateway.sandbox.recovery;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.iwhaleai.byai.framework.core.WorkerRegistry;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import java.util.*;
import org.junit.jupiter.api.Test;

class SandboxRecoveryRecorderTest {
    final SandboxRecoveryStore store = mock(SandboxRecoveryStore.class);
    final WorkerRegistry workers = mock(WorkerRegistry.class);
    final SandboxRecoveryRecorder recorder = new SandboxRecoveryRecorder(store, workers);
    Map<String,String> event() {
        return new LinkedHashMap<>(Map.of("stream","stream","group","g","messageId","1-0",
            "oldSandboxId","old","oldConsumer","old-worker","sessionId","11","commandId","22",
            "action","AUTO_TASK","startedAt",Long.toString(System.currentTimeMillis()),"outcome","AWAITING_RECLAIM"));
    }
    void prepare() {
        when(store.lock(eq("history-observer"),anyString())).thenReturn(true);
        when(store.trackedRecoveries()).thenReturn(Map.of("key",event()));
    }
    @Test void snapshotsCommandIdentityBeforeRebuild() {
        var record = new SsSandboxRecord(); record.setUserCode("test"); record.setSandboxId("old");
        record.setSandboxType("byclaw-dsh-low");
        String queue = com.iwhaleai.byai.framework.common.Constants.QueueNames.ctrlStream("BYCLAW_DSH_test");
        when(store.queuesForStream(queue)).thenReturn(List.of(new SandboxRecoveryStore.Queue(queue,"g","COMMAND",1,null)));
        String payload = "{\"header\":{\"session_id\":\"11\",\"message_id\":\"22\"},\"body\":{\"content\":\"token=hidden123\"}}";
        when(store.messages(queue,"g","PENDING",null)).thenReturn(new SandboxRecoveryStore.MessagePage(List.of(
            new SandboxRecoveryStore.Message("1-0","old-worker",70000,1,"PENDING",Map.of("data",payload))),null));
        recorder.lifecycle(record,"DETECTED",null);
        verify(store).trackRecovery(anyString(),argThat(e -> "11".equals(e.get("sessionId"))
            && "22".equals(e.get("commandId")) && !e.get("content").contains("hidden123")));
    }
    @Test void recordsRebuildWithoutPendingTasks() {
        var record = new SsSandboxRecord(); record.setUserCode("test"); record.setSandboxId("old");
        recorder.lifecycle(record,"REBUILT","new");
        verify(store).audit(eq("lifecycle"),eq(""),eq("old"),argThat(e ->
            "REBUILT".equals(e.get("outcome")) && "new".equals(e.get("newSandboxId"))));
    }
    @Test void changedConsumerIsObservedWithoutAcknowledgingTask() {
        prepare();
        when(store.pending("stream","g","1-0")).thenReturn(new SandboxRecoveryStore.Message("1-0","new-worker",0,2,"PENDING",Map.of()));
        recorder.observe();
        verify(store).audit(eq("stream"),eq("g"),eq("1-0"),argThat(e -> "RECLAIMED".equals(e.get("outcome"))));
        verify(store,never()).acknowledge(any(),any(),any());
    }
    @Test void ackAloneDoesNotProveSuccess() {
        prepare();
        when(store.pending("stream","g","1-0")).thenThrow(new IllegalArgumentException("gone"));
        recorder.observe();
        verify(store).audit(eq("stream"),eq("g"),eq("1-0"),argThat(e -> "RESULT_UNKNOWN".equals(e.get("outcome"))));
        verify(store).stopTracking("key");
    }
    @Test void terminalExecutionRemainsVisibleAfterAck() {
        prepare();
        when(workers.getExecutionByMessageId("11","22")).thenReturn(Map.of("status","completed"));
        recorder.observe();
        verify(store).audit(eq("stream"),eq("g"),eq("1-0"),argThat(e -> "TASK_FINISHED".equals(e.get("outcome"))));
        verify(store).stopTracking("key");
    }
    @Test void auditFailureDoesNotInterruptRebuild() {
        var record = new SsSandboxRecord(); record.setUserCode("test"); record.setSandboxId("old");
        doThrow(new IllegalStateException("redis down")).when(store).audit(any(),any(),any(),any());
        assertThatCode(() -> recorder.lifecycle(record,"REBUILT","new")).doesNotThrowAnyException();
    }
}
