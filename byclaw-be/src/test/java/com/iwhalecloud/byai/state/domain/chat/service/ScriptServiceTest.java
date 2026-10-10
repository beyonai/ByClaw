package com.iwhalecloud.byai.state.domain.chat.service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorAuthService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.message.enums.MsgStatus;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.message.service.MemoryMessageService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.doReturn;
import static org.mockito.ArgumentMatchers.*;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import com.iwhalecloud.byai.state.domain.chat.model.ChatResponse;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ScriptServiceTest {

    private ConnectorAuthService connectorAuthService;
    private ScriptService service;

    @BeforeEach
    void setUp() {
        connectorAuthService = mock(ConnectorAuthService.class);
        service = new ScriptService();
        ReflectionTestUtils.setField(service, "connectorAuthService", connectorAuthService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1001L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void metadataIncludesEveryActiveConnectorAsBoolean() {
        Map<String, Boolean> states = new LinkedHashMap<>();
        states.put("dws", true);
        states.put("fws", false);
        states.put("wecomcli", false);
        when(connectorAuthService.findConnectorEnableStates(1001L)).thenReturn(states);

        Map<String, Object> metadata = service.getMetadataByassistantChatDto(new AssistantChatDto());

        assertThat(metadata).containsEntry("authConnectorList", states);
        assertThat(metadata).doesNotContainKey("authConnector");
    }

    @Test
    void userMessagePersistenceUsesWriteBehindInsteadOfBlockingTheDispatchThread() {
        MemoryMessageService memoryMessageService = mock(MemoryMessageService.class);
        ScopedMessageWriteBehind writeBehind = mock(ScopedMessageWriteBehind.class);
        ReflectionTestUtils.setField(service, "memoryMessageService", memoryMessageService);
        ReflectionTestUtils.setField(service, "scopedMessageWriteBehind", writeBehind);

        AssistantChatDto chatDto = new AssistantChatDto();
        chatDto.setChatContent("fast inbound");
        ChatProcessContext context = new ChatProcessContext(null, chatDto);
        context.sessionId = 20L;
        context.userMessageId = 21L;
        context.taskId = 22L;
        ByaiMessageHotDtoDto prepared = new ByaiMessageHotDtoDto();
        prepared.setSessionId(20L);
        prepared.setMessageId(21L);
        when(memoryMessageService.generateMessage(eq(20L),
            anyInt(), any(),
            same(chatDto))).thenReturn(prepared);

        ReflectionTestUtils.invokeMethod(service, "saveUserContent", context);

        verify(writeBehind).enqueue("root:user:20:21", 20L, prepared, true);
        verify(memoryMessageService, never()).save(anyLong(),
            anyInt(), any(),
            any());
    }

    @Test
    void recoveredTurnBroadcastsItsPersistedCompletionWithoutAnOriginalConnection() {
        ScriptService recoveredService = spy(service);
        MultiDeviceBroadcastService broadcast =
            mock(MultiDeviceBroadcastService.class);
        ReflectionTestUtils.setField(recoveredService, "multiDeviceBroadcastService", broadcast);
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.sessionId = 20L;
        ctx.userId = 1001L;
        ctx.recoveryOnly = true;
        ChatResponse response =
            new ChatResponse();
        doReturn(response).when(recoveredService)
            .resolveMemory(ctx, ctx.assistantChatDto, ctx.sessionId, ctx.messageContext, ctx.resMsg);
        recoveredService.storeMessage(ctx);
        verify(broadcast).broadcastToUserDevices(eq(1001L),
            eq(20L), eq("appStreamResponse"),
            anyString(), isNull());
        assertThat(ctx.chatResponse).isSameAs(response);
    }

    @Test
    void tenantBackgroundInputCreatesTheFrontendContextThroughTheTenantChannel() {
        MultiDeviceBroadcastService broadcast = mock(MultiDeviceBroadcastService.class);
        ReflectionTestUtils.setField(service, "multiDeviceBroadcastService", broadcast);
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.sessionId = 20L;
        ctx.userId = 1001L;
        ctx.tenantContext = new com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext(1001L, 10L, "MEMBER");
        ctx.assistantChatDto.setClientRequestId("group-source-agent");
        ctx.assistantChatDto.setAgentId(90L);
        ctx.askMsg = new ByaiMessageHotDtoDto();
        ctx.askMsg.setSessionId(20L);
        ctx.askMsg.setMessageId(22L);

        ReflectionTestUtils.invokeMethod(service, "broadcastUserMessage", ctx);

        var message = org.mockito.ArgumentCaptor.forClass(com.alibaba.fastjson.JSONObject.class);
        verify(broadcast).broadcastTenantRawToUser(eq(ctx.tenantContext), message.capture(), isNull());
        assertThat(message.getValue().getString("type")).isEqualTo("NEW_MESSAGE");
        assertThat(message.getValue().getString("clientRequestId")).isEqualTo("group-source-agent");
        assertThat(message.getValue().getLong("sessionId")).isEqualTo(20L);
        verify(broadcast, never()).broadcastRawToUser(any(), any(), any());

        ctx.suppressUserEvents = true;
        org.mockito.Mockito.clearInvocations(broadcast);
        ReflectionTestUtils.invokeMethod(service, "broadcastUserMessage", ctx);
        org.mockito.Mockito.verifyNoInteractions(broadcast);
    }

    @Test
    void tenantBackgroundInitializationUsesTheTenantChatStream() {
        MultiDeviceBroadcastService broadcast = mock(MultiDeviceBroadcastService.class);
        ReflectionTestUtils.setField(service, "multiDeviceBroadcastService", broadcast);
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.sessionId = 20L;
        ctx.userId = 1001L;
        ctx.modelAnswerMessageId = 21L;
        ctx.userMessageId = 22L;
        ctx.traceId = "task-trace";
        ctx.clientRequestId = "group-source-agent";
        ctx.tenantContext = new com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext(1001L, 10L, "MEMBER");

        ReflectionTestUtils.invokeMethod(service, "broadcastInitEvent", ctx);

        var event = org.mockito.ArgumentCaptor.forClass(com.alibaba.fastjson.JSONObject.class);
        verify(broadcast).broadcastTenantRawEvent(eq(ctx.tenantContext), eq(20L), event.capture(),
            isNull(), eq("group-source-agent"));
        assertThat(event.getValue().getString("event_type")).isEqualTo("initialization");
        assertThat(event.getValue().getString("trace_id")).isEqualTo("task-trace");
        var payload = com.alibaba.fastjson.JSONObject.parseObject(event.getValue().getString("data"));
        assertThat(payload.getLong("messageId")).isEqualTo(21L);
        assertThat(payload.getLong("queryMessageId")).isEqualTo(22L);
        verify(broadcast, never()).broadcastToUserDevices(any(), any(), any(), any(), any());

        ctx.suppressUserEvents = true;
        org.mockito.Mockito.clearInvocations(broadcast);
        ReflectionTestUtils.invokeMethod(service, "broadcastInitEvent", ctx);
        org.mockito.Mockito.verifyNoInteractions(broadcast);
    }

    @Test
    void flushFromSnapshotPersistsBothCompletionSignals() {
        RunningChatSnapshotService snapshotService = mock(RunningChatSnapshotService.class);
        ByaiMessageHotService messageHotService = mock(ByaiMessageHotService.class);
        ReflectionTestUtils.setField(service, "runningChatSnapshotService", snapshotService);
        ReflectionTestUtils.setField(service, "byaiMessageHotService", messageHotService);
        RunningChatSnapshotResponse snapshot = new RunningChatSnapshotResponse();
        snapshot.setMessageId(21L);
        when(snapshotService.get(20L, null, 21L)).thenReturn(snapshot);

        boolean persisted = service.flushFromSnapshot(20L, 21L);

        assertThat(persisted).isTrue();
        assertThat(snapshot.getMsgStatus()).isEqualTo(MsgStatus.FINISH.getCode());
        assertThat(snapshot.isComplete()).isTrue();
        assertThat(snapshot.getFinalContent()).isNull();
        assertThat(snapshot.isReplaceFinalContent()).isTrue();
        verify(messageHotService).updateSelective(snapshot);
    }
}
