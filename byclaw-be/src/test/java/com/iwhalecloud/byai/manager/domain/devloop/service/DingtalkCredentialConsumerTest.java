package com.iwhalecloud.byai.manager.domain.devloop.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockConstruction;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.time.Duration;
import java.util.List;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.CliResult;
import com.iwhalecloud.byai.manager.domain.connector.provider.dingtalk.DwsDingtalkAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.devloop.ScanLog;
import com.iwhalecloud.byai.manager.entity.devloop.ScanRequireItem;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;

class DingtalkCredentialConsumerTest {

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void scansWithSourceOwnersCredentialsAndPreservesBusinessArguments(boolean todo) throws Exception {
        Fixture fixture = new Fixture(todo);
        String output = todo
            ? "{\"result\":{\"todoCards\":[{\"id\":\"item-1\",\"subject\":\"needs fix\",\"description\":\"details\"}]}}"
            : "{\"result\":{\"messages\":[{\"openMessageId\":\"item-1\",\"content\":\"needs fix\",\"sender\":\"Alice\"}]}}";
        when(fixture.dws.runCommand(eq("101"), anyList(), eq(Duration.ofSeconds(60)), anyInt()))
            .thenReturn(new CliResult(0, output));
        ScanRequireItem item = new ScanRequireItem();
        when(fixture.logs.createItem(eq(3L), eq(1L), anyString(), anyString(), eq("item-1"), eq(null), eq("created")))
            .thenReturn(item);

        try (var localProcesses = mockConstruction(ProcessBuilder.class,
            (builder, context) -> when(builder.start()).thenThrow(new IOException("BE-local DWS forbidden")))) {
            assertThat(fixture.scan()).containsExactly(item);
            assertThat(localProcesses.constructed()).isEmpty();
        }

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<String>> command = ArgumentCaptor.forClass(List.class);
        verify(fixture.dws).runCommand(eq("101"), command.capture(), eq(Duration.ofSeconds(60)), eq(1024 * 1024));
        assertThat(command.getValue()).containsSubsequence("--format", "json", "--profile", "corp-1");
        if (todo) {
            assertThat(command.getValue()).containsSubsequence("dws", "todo", "task", "list", "--role-types", "executor",
                "--status", "false", "--size", "50");
        } else {
            assertThat(command.getValue()).containsSubsequence("dws", "chat", "message", "list", "--group", "group-1");
            assertThat(command.getValue()).containsSubsequence("--direction", "newer", "--limit", "50");
        }
        verify(fixture.logs).completeLog(3L, 1, 1);
        verify(fixture.sources).updateLastScanTime(1L);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void truncatedOutputDoesNotMarkScanCompleteOrAdvanceCursor(boolean todo) throws Exception {
        Fixture fixture = new Fixture(todo);
        when(fixture.dws.runCommand(eq("101"), anyList(), any(Duration.class), anyInt()))
            .thenReturn(new CliResult(0, "{\"result\":[]}", true));

        try (var ignored = mockConstruction(ProcessBuilder.class,
            (builder, context) -> when(builder.start()).thenThrow(new IOException("BE-local DWS forbidden")))) {
            assertThat(fixture.scan()).isNull();
        }

        verify(fixture.logs).failLog(3L, "DWS command output truncated");
        verify(fixture.logs, never()).completeLog(any(), anyInt(), anyInt());
        verify(fixture.sources, never()).updateLastScanTime(any());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void timeoutDoesNotMarkScanCompleteOrAdvanceCursor(boolean todo) throws Exception {
        Fixture fixture = new Fixture(todo);
        when(fixture.dws.runCommand(eq("101"), anyList(), any(Duration.class), anyInt()))
            .thenReturn(new CliResult(124, ""));

        try (var ignored = mockConstruction(ProcessBuilder.class,
            (builder, context) -> when(builder.start()).thenThrow(new IOException("BE-local DWS forbidden")))) {
            assertThat(fixture.scan()).isEmpty();
        }

        verify(fixture.logs).failLog(3L, "DWS command timeout");
        verify(fixture.logs, never()).completeLog(any(), anyInt(), anyInt());
        verify(fixture.sources, never()).updateLastScanTime(any());
    }

    private static final class Fixture {
        private final boolean todo;
        private final Object service;
        private final DwsAuthService dws = mock(DwsAuthService.class);
        private final ScanLogService logs = mock(ScanLogService.class);
        private final ScanSourceService sources = mock(ScanSourceService.class);
        private final ScanSource source = new ScanSource();

        private Fixture(boolean todo) {
            this.todo = todo;
            this.service = todo ? new DingtalkTodoScanService() : new DingtalkScanService();
            DwsDingtalkAuthorizationProvider auth = mock(DwsDingtalkAuthorizationProvider.class);
            ConnectorInfoService connectors = mock(ConnectorInfoService.class);
            ConnectorInfo connector = new ConnectorInfo();
            when(connectors.findByCode("dingtalk")).thenReturn(connector);
            when(auth.verify(101L, connector)).thenReturn(
                new AuthorizationStatusResult(AuthorizationStatus.CONNECTED, null, null, null, null, null, null));
            ReflectionTestUtils.setField(service, "dwsAuthService", dws);
            ReflectionTestUtils.setField(service, "scanLogService", logs);
            ReflectionTestUtils.setField(service, "scanSourceService", sources);
            ReflectionTestUtils.setField(service, "dwsAuthorizationProvider", auth);
            ReflectionTestUtils.setField(service, "connectorInfoService", connectors);
            source.setSourceId(1L);
            source.setProjectId(2L);
            source.setCreateBy("101");
            source.setConfig("{\"groupId\":\"group-1\",\"keyword\":\"fix\",\"corpId\":\"corp-1\"}");
            ScanLog scanLog = new ScanLog();
            scanLog.setLogId(3L);
            when(logs.createLog(1L, 2L)).thenReturn(scanLog);
        }

        private List<ScanRequireItem> scan() {
            return todo ? ((DingtalkTodoScanService) service).scan(source) : ((DingtalkScanService) service).scan(source);
        }
    }
}
