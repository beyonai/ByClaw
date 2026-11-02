package com.iwhalecloud.byai.gateway.sandbox.recovery;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson.JSON;
import com.iwhaleai.byai.framework.common.Constants;
import com.iwhaleai.byai.framework.core.WorkerRegistry;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.*;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import java.util.*;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;

class SandboxRecoveryServiceTest {
    final SandboxRecoveryStore store = mock(SandboxRecoveryStore.class);
    final WorkerRegistry workers = mock(WorkerRegistry.class);
    final SandboxService sandboxes = mock(SandboxService.class);
    final SandboxUserContextRunner users = mock(SandboxUserContextRunner.class);
    final SsSandboxRecordMapper records = mock(SsSandboxRecordMapper.class);
    final SandboxRecoveryService service = new SandboxRecoveryService(store, workers, sandboxes, users, records);
    final String stream = Constants.QueueNames.ctrlStream("BYCLAW_DSH_test-user");
    final String id = "1792367536149-0";
    final String group = "group";

    SandboxRecoveryStore.Message message(long idle, String fields) {
        return new SandboxRecoveryStore.Message(id, "old-worker", idle, 2, "PENDING", Map.of("data", fields));
    }
    String payload() {
        return """
            {"action_type":"ASK_AGENT","header":{"user_code":"test-user","user_name":"测试用户",
            "session_id":"101","message_id":"102","target_agent_type":"BYCLAW_DSH_test-user",
            "metadata":{"resourceName":"测试专家团","resourceId":"201","Beyond-Token":"NEVER_RETURN_HEADER_SECRET"}},
            "body":{"content":"测试 password=secret123 token=secret456","extra_payload":{"secret":"NEVER_RETURN_EXTRA_SECRET"}}}
            """;
    }
    @BeforeEach void setup() {
        LoginInfo admin = new LoginInfo(); admin.setUserCode("adminvip"); CurrentUserHolder.setLoginInfo(admin);
        when(store.pending(stream, group, id)).thenReturn(message(120000, payload()));
        when(store.lock(anyString(), anyString())).thenReturn(true);
        when(store.audit(anyString(), anyString(), anyString())).thenReturn(Map.of());
        doAnswer(call -> { ((Runnable) call.getArgument(1)).run(); return null; }).when(users).runAsUser(anyString(), any());
    }
    @AfterEach void clear() { CurrentUserHolder.clearLoginInfo(); }
    SandboxRecoveryService.Action action(String name) {
        return new SandboxRecoveryService.Action(stream, group, id, name, "已核对本次测试任务");
    }
    @Test void exposesBusinessFieldsWithoutHeadersAndDoesNotInventStopTime() {
        var result = service.view(stream, group, message(120000, payload()));
        assertThat(result).containsEntry("resourceName", "测试专家团").containsEntry("userCode", "test-user")
            .containsEntry("stoppedAt", null).containsEntry("canWake", true);
        assertThat(JSON.toJSONString(result)).doesNotContain("NEVER_RETURN", "secret123", "secret456", "Beyond-Token");
    }
    @Test void onlineConsumerOrLiveTargetPreventsManualActions() {
        when(store.workerOnline("old-worker")).thenReturn(true);
        var result = service.view(stream, group, message(120000, payload()));
        assertThat(result).containsEntry("canWake", false).containsEntry("canDismiss", false);
        assertThatThrownBy(() -> service.act(action("DISMISS"))).isInstanceOf(IllegalArgumentException.class);
        verify(store, never()).acknowledge(any(), any(), any());
    }
    @Test void wakeKeepsOriginalMessagePendingAndUsesTargetRouting() {
        service.act(action("WAKE"));
        verify(sandboxes).restartSandboxForTargetWithoutWait("test-user", -1L, "BYCLAW_DSH_test-user");
        verify(store, never()).acknowledge(any(), any(), any());
        verify(store).unlock(eq("BYCLAW_DSH_test-user"), anyString());
        verify(store, atLeastOnce()).audit(eq(stream), eq(group), eq(id), argThat(a -> "WAKE_REQUESTED".equals(a.get("outcome"))));
    }
    @Test void rechecksStateInsideLockAndDoesNotActOnReclaimedMessage() {
        when(store.pending(stream, group, id)).thenReturn(message(120000, payload()), message(1, payload()));
        assertThatThrownBy(() -> service.act(action("WAKE"))).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(sandboxes);
    }
    @Test void staleAcknowledgeCannotBeReportedSuccessful() {
        when(store.acknowledge(any(), any(), any())).thenReturn(false);
        assertThatThrownBy(() -> service.act(action("DISMISS"))).hasMessageContaining("重新领取");
    }
    @Test void auditMustBeWrittenBeforeMutation() {
        doThrow(new IllegalStateException("unavailable")).when(store).audit(any(), any(), any(), anyMap());
        assertThatThrownBy(() -> service.act(action("WAKE"))).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(sandboxes);
        verify(store).unlock(any(), any());
    }
    @Test void duplicateAdminActionIsRejected() {
        when(store.lock(any(), any())).thenReturn(false);
        assertThatThrownBy(() -> service.act(action("WAKE"))).hasMessageContaining("已有管理员操作");
        verifyNoInteractions(sandboxes);
    }
    @Test void terminalExecutionCanBeDismissedButNeverWoken() {
        for (String status : List.of("completed", "SUCCESS", "ALREADY_FINISHED")) {
            when(workers.getExecutionByMessageId("101", "102")).thenReturn(Map.of("status", status));
            var result = service.view(stream, group, message(120000, payload()));
            assertThat(result).containsEntry("canWake", false).containsEntry("canDismiss", true);
        }
    }
    @Test void malformedOrTrimmedEntriesStayVisibleAndUnactionable() {
        for (var entry : List.of(message(120000, "null"), message(120000, "invalid"), message(120000, "{\"user_code\":\"test-user\"}"),
            new SandboxRecoveryStore.Message(id, "old-worker", 120000, 2, "PENDING", Map.of()))) {
            var result = service.view(stream, group, entry);
            assertThat(result).containsEntry("canWake", false).containsEntry("canDismiss", false);
        }
    }
    @Test void workerSpecificQueueDoesNotPretendNewSandboxCanReclaimIt() {
        var result = service.view(Constants.QueueNames.workerCtrlStream("byclaw-dsh-old"), group, message(120000, payload()));
        assertThat(result).containsEntry("canWake", false);
    }
    @Test void codeTargetUserCanBeInferredWithoutCorruptingPrefix() {
        String p = payload().replace("\"user_code\":\"test-user\",", "").replace("BYCLAW_DSH_test-user", "BYCLAW_CODE_test-user");
        assertThat(service.view(Constants.QueueNames.ctrlStream("BYCLAW_CODE_test-user"), group, message(120000, p)))
            .containsEntry("userCode", "test-user").containsEntry("canWake", true);
    }
    @Test void wakeFailureIsAuditedWithoutLeakingConnectionCredentials() {
        doThrow(new IllegalStateException("redis://user:private@host")).when(sandboxes)
            .restartSandboxForTargetWithoutWait(any(), any(), any());
        assertThatThrownBy(() -> service.act(action("WAKE"))).isInstanceOf(IllegalStateException.class);
        ArgumentCaptor<Map<String, String>> audit = ArgumentCaptor.forClass(Map.class);
        verify(store, atLeastOnce()).audit(eq(stream), eq(group), eq(id), audit.capture());
        assertThat(audit.getValue()).containsEntry("outcome", "FAILED");
        assertThat(audit.getValue().get("error")).doesNotContain("private", "redis://");
    }
}
