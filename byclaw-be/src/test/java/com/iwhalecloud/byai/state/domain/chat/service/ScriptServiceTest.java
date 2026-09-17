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
        when(memoryMessageService.generateMessage(org.mockito.ArgumentMatchers.eq(20L),
            org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.same(chatDto))).thenReturn(prepared);

        ReflectionTestUtils.invokeMethod(service, "saveUserContent", context);

        verify(writeBehind).enqueue("root:user:20:21", 20L, prepared, true);
        verify(memoryMessageService, never()).save(org.mockito.ArgumentMatchers.anyLong(),
            org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any());
    }

    @Test
    void recoveredTurnBroadcastsItsPersistedCompletionWithoutAnOriginalConnection() {
        ScriptService recoveredService = org.mockito.Mockito.spy(service);
        com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService broadcast =
            mock(com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService.class);
        ReflectionTestUtils.setField(recoveredService, "multiDeviceBroadcastService", broadcast);
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.sessionId = 20L;
        ctx.userId = 1001L;
        ctx.recoveryOnly = true;
        com.iwhalecloud.byai.state.domain.chat.model.ChatResponse response =
            new com.iwhalecloud.byai.state.domain.chat.model.ChatResponse();
        org.mockito.Mockito.doReturn(response).when(recoveredService)
            .resolveMemory(ctx, ctx.assistantChatDto, ctx.sessionId, ctx.messageContext, ctx.resMsg);
        recoveredService.storeMessage(ctx);
        verify(broadcast).broadcastToUserDevices(org.mockito.ArgumentMatchers.eq(1001L),
            org.mockito.ArgumentMatchers.eq(20L), org.mockito.ArgumentMatchers.eq("appStreamResponse"),
            org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.isNull());
        assertThat(ctx.chatResponse).isSameAs(response);
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
        verify(messageHotService).updateSelective(snapshot);
    }
}
