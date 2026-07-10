package com.iwhalecloud.byai.state.domain.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Date;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.constants.chat.ChatObjType;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;

class ChatRuntimeStateServiceTest {

    private ChatRuntimeStateService service;
    private RunningChatSnapshotService snapshotService;

    @BeforeEach
    void setUp() {
        service = new ChatRuntimeStateService();
        snapshotService = mock(RunningChatSnapshotService.class);
        when(snapshotService.hydrateMessageContext(any(), any())).thenReturn(null);
    }

    @Test
    void buildRecoveryContextRestoresAskMsgFromRuntimeState() {
        ByaiMessageHotDtoDto askMsg = new ByaiMessageHotDtoDto();
        askMsg.setSessionId(10L);
        askMsg.setMessageId(100L);
        askMsg.setMessageContent("hello");
        askMsg.setCreateTime(new Date());
        askMsg.setObjId(200L);
        askMsg.setObjType(ChatObjType.HUMAN);

        ChatProcessContext ctx = service.buildRecoveryContext(runtimeState(askMsg), snapshotService);

        assertNotNull(ctx);
        assertSame(askMsg, ctx.askMsg);
    }

    @Test
    void buildRecoveryContextCreatesFallbackAskMsgForLegacyRuntimeState() {
        long startedAt = 1_700_000_000_000L;
        ChatRuntimeState state = runtimeState(null);
        state.setStartedAt(startedAt);

        ChatProcessContext ctx = service.buildRecoveryContext(state, snapshotService);

        assertNotNull(ctx);
        assertNotNull(ctx.askMsg);
        assertEquals(10L, ctx.askMsg.getSessionId());
        assertEquals(100L, ctx.askMsg.getMessageId());
        assertEquals("hello", ctx.askMsg.getMessageContent());
        assertEquals(new Date(startedAt), ctx.askMsg.getCreateTime());
        assertEquals(200L, ctx.askMsg.getObjId());
        assertEquals(200L, ctx.askMsg.getCreatorId());
        assertEquals(ChatObjType.HUMAN, ctx.askMsg.getObjType());
        assertEquals(ChatUseageEnum.USER_INPUT.getCode(), ctx.askMsg.getUsage());
    }

    private ChatRuntimeState runtimeState(ByaiMessageHotDtoDto askMsg) {
        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setAgentType("001");
        assistantChatDto.setChatContent("hello");

        ChatRuntimeState state = new ChatRuntimeState();
        state.setSessionId(10L);
        state.setTraceId("trace-1");
        state.setUserMessageId(100L);
        state.setModelAnswerMessageId(101L);
        state.setTaskId(300L);
        state.setUserId(200L);
        state.setAssistantChatDto(assistantChatDto);
        state.setAskMsg(askMsg);
        state.setToken("token");
        return state;
    }
}
