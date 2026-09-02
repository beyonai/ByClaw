package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.test.util.ReflectionTestUtils;

class StreamRecordProcessorTest {

    private StreamRecordProcessor processor;
    private SessionStreamEventRouter router;
    private ScriptService scriptService;
    private TerminalPersistMarkerService terminalPersistMarkerService;

    @BeforeEach
    void setUp() {
        processor = new StreamRecordProcessor();
        router = mock(SessionStreamEventRouter.class);
        scriptService = mock(ScriptService.class);
        ReflectionTestUtils.setField(processor, "sessionStreamEventRouter", router);
        ReflectionTestUtils.setField(processor, "scriptService", scriptService);
        ReflectionTestUtils.setField(processor, "runningChatSnapshotService", mock(RunningChatSnapshotService.class));
        ReflectionTestUtils.setField(processor, "sessionStreamManager", mock(SessionStreamManager.class));
        terminalPersistMarkerService = mock(TerminalPersistMarkerService.class);
        ReflectionTestUtils.setField(processor, "terminalPersistMarkerService", terminalPersistMarkerService);
    }

    @Test
    void persistsTerminalEventBeforeReturningForAck() {
        ChatProcessContext context = new ChatProcessContext(null, null);
        MapRecord<String, String, String> record = record();
        when(router.dispatch(org.mockito.ArgumentMatchers.any())).thenReturn(
            StreamDispatchResult.terminalHandled(context));
        when(scriptService.persistAsyncGatewayContext(context)).thenReturn(true);

        processor.process(record);

        verify(scriptService).persistAsyncGatewayContext(context);
    }

    /**
     * 标记必须在落库成功之后写入：若顺序颠倒，进程在落库前崩溃会留下「已完成」痕迹，
     * 重投时被误判为无需落库而直接 ACK，回答永久丢失。
     */
    @Test
    void writesPersistMarkerOnlyAfterSuccessfulPersist() {
        ChatProcessContext context = new ChatProcessContext(null, null);
        context.sessionId = 10L;
        MapRecord<String, String, String> record = record();
        when(router.dispatch(org.mockito.ArgumentMatchers.any())).thenReturn(
            StreamDispatchResult.terminalHandled(context));
        when(scriptService.persistAsyncGatewayContext(context)).thenReturn(true);

        processor.process(record);

        InOrder inOrder = inOrder(scriptService, terminalPersistMarkerService);
        inOrder.verify(scriptService).persistAsyncGatewayContext(context);
        inOrder.verify(terminalPersistMarkerService).markPersisted(10L, "1-0");
    }

    @Test
    void skipsMarkerAndKeepsPendingWhenPersistFails() {
        ChatProcessContext context = new ChatProcessContext(null, null);
        context.sessionId = 10L;
        MapRecord<String, String, String> record = record();
        when(router.dispatch(org.mockito.ArgumentMatchers.any())).thenReturn(
            StreamDispatchResult.terminalHandled(context));
        when(scriptService.persistAsyncGatewayContext(context)).thenReturn(false);

        StreamDispatchResult result = processor.process(record);

        assertThat(result.shouldAcknowledge()).as("落库失败必须保留 pending").isFalse();
        verify(terminalPersistMarkerService, never()).markPersisted(any(), anyString());
    }

    /**
     * 已落库的 terminal 重投：跳过落库，直接进入 ACK 与收尾。
     */
    @Test
    void skipsPersistForAlreadyPersistedTerminalReplay() {
        ChatProcessContext context = new ChatProcessContext(null, null);
        context.sessionId = 10L;
        MapRecord<String, String, String> record = record();
        when(router.dispatch(org.mockito.ArgumentMatchers.any())).thenReturn(
            StreamDispatchResult.terminalAlreadyPersisted(context));

        StreamDispatchResult result = processor.process(record);

        assertThat(result.shouldAcknowledge()).isTrue();
        verify(scriptService, never()).persistAsyncGatewayContext(any());
        verify(terminalPersistMarkerService, never()).markPersisted(any(), anyString());
    }

    @SuppressWarnings("unchecked")
    private MapRecord<String, String, String> record() {
        MapRecord<String, String, String> record = mock(MapRecord.class);
        when(record.getValue()).thenReturn(Map.of("data", "{\"session_id\":\"10\"}"));
        when(record.getStream()).thenReturn("stream-10");
        when(record.getId()).thenReturn(RecordId.of("1-0"));
        return record;
    }
}
