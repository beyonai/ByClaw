package com.iwhalecloud.byai.state.domain.chat.service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorAuthService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
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
}
