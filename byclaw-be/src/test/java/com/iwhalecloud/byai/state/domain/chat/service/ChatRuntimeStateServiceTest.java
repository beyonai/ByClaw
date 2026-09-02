package com.iwhalecloud.byai.state.domain.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.Date;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson.JSON;
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

    @Test
    void saveAddsSessionToRuntimeIndex() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        ValueOperations<String, Object> valueOperations = mock(ValueOperations.class);
        SetOperations<String, Object> setOperations = mock(SetOperations.class);
        ChatRuntimeInstance chatRuntimeInstance = mock(ChatRuntimeInstance.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(redisTemplate.opsForSet()).thenReturn(setOperations);
        when(chatRuntimeInstance.getInstanceId()).thenReturn("instance-1");
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);
        ReflectionTestUtils.setField(service, "chatRuntimeInstance", chatRuntimeInstance);

        ChatProcessContext ctx = new ChatProcessContext(null, assistantChatDto());
        ctx.sessionId = 10L;
        ctx.traceId = "trace-1";
        ctx.modelAnswerMessageId = 101L;

        service.save(ctx, "token-1");

        verify(valueOperations).set(eq("byai:chat:runtime:10"), anyString(), eq(24 * 60 * 60L),
            eq(TimeUnit.SECONDS));
        verify(setOperations).add("byai:chat:runtime:index", "10");
    }

    @Test
    void touchRefreshesSessionInRuntimeIndex() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        ValueOperations<String, Object> valueOperations = mock(ValueOperations.class);
        SetOperations<String, Object> setOperations = mock(SetOperations.class);
        ChatRuntimeInstance chatRuntimeInstance = mock(ChatRuntimeInstance.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(redisTemplate.opsForSet()).thenReturn(setOperations);
        when(chatRuntimeInstance.getInstanceId()).thenReturn("instance-1");
        when(redisTemplate.execute(any(DefaultRedisScript.class), eq(List.of("byai:chat:runtime:10")),
            eq("token-1"), eq("instance-1"), anyString(), eq(String.valueOf(24 * 60 * 60L)))).thenReturn(1L);
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);
        ReflectionTestUtils.setField(service, "chatRuntimeInstance", chatRuntimeInstance);

        ChatProcessContext ctx = new ChatProcessContext(null, assistantChatDto());
        ctx.sessionId = 10L;
        ctx.runningOutputStreamToken = "token-1";

        service.touch(ctx);

        verify(setOperations).add("byai:chat:runtime:index", "10");
    }

    @Test
    @SuppressWarnings("unchecked")
    void requestHandoffUpdatesOnlyTheCurrentOwnerToken() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        SetOperations<String, Object> setOperations = mock(SetOperations.class);
        ChatRuntimeInstance chatRuntimeInstance = mock(ChatRuntimeInstance.class);
        when(redisTemplate.opsForSet()).thenReturn(setOperations);
        when(chatRuntimeInstance.getInstanceId()).thenReturn("instance-1");
        when(redisTemplate.execute(any(DefaultRedisScript.class), eq(List.of("byai:chat:runtime:10")),
            eq("token-1"), eq("instance-1"), anyString(), eq(String.valueOf(24 * 60 * 60L)))).thenReturn(1L);
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);
        ReflectionTestUtils.setField(service, "chatRuntimeInstance", chatRuntimeInstance);

        ChatProcessContext ctx = new ChatProcessContext(null, assistantChatDto());
        ctx.sessionId = 10L;
        ctx.runningOutputStreamToken = "token-1";

        org.junit.jupiter.api.Assertions.assertTrue(service.requestHandoff(ctx));
        verify(setOperations).add("byai:chat:runtime:index", "10");
    }

    @Test
    void listRunningStatesUsesRuntimeIndexInsteadOfKeyspaceScan() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        ValueOperations<String, Object> valueOperations = mock(ValueOperations.class);
        SetOperations<String, Object> setOperations = mock(SetOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(redisTemplate.opsForSet()).thenReturn(setOperations);
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);

        ChatRuntimeState running = runtimeState(null);
        running.setStatus(ChatRuntimeState.STATUS_RUNNING);
        ChatRuntimeState finished = runtimeState(null);
        finished.setSessionId(11L);
        finished.setStatus(ChatRuntimeState.STATUS_FINISHED);
        ChatRuntimeState handoff = runtimeState(null);
        handoff.setSessionId(13L);
        handoff.setStatus(ChatRuntimeState.STATUS_HANDOFF_REQUESTED);
        Set<Object> indexMembers = new LinkedHashSet<>();
        indexMembers.add("10");
        indexMembers.add("11");
        indexMembers.add("12");
        indexMembers.add("13");
        when(setOperations.members("byai:chat:runtime:index")).thenReturn(indexMembers);
        when(valueOperations.get("byai:chat:runtime:10")).thenReturn(JSON.toJSONString(running));
        when(valueOperations.get("byai:chat:runtime:11")).thenReturn(JSON.toJSONString(finished));
        when(valueOperations.get("byai:chat:runtime:12")).thenReturn(null);
        when(valueOperations.get("byai:chat:runtime:13")).thenReturn(JSON.toJSONString(handoff));

        List<ChatRuntimeState> states = service.listRunningStates();

        assertEquals(2, states.size());
        assertEquals(10L, states.get(0).getSessionId());
        assertEquals(13L, states.get(1).getSessionId());
        verify(setOperations).remove("byai:chat:runtime:index", "11");
        verify(setOperations).remove("byai:chat:runtime:index", "12");
    }

    /**
     * 运行态解析失败时不得剔除索引成员：一次瞬时反序列化异常若把索引清掉，
     * 该会话将永久无法被重启恢复扫描发现，未落库的回答随之丢失。
     */
    @Test
    void listRunningStatesKeepsIndexWhenRuntimeStateExistsButUnparsable() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        ValueOperations<String, Object> valueOperations = mock(ValueOperations.class);
        SetOperations<String, Object> setOperations = mock(SetOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(redisTemplate.opsForSet()).thenReturn(setOperations);
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);

        Set<Object> indexMembers = new LinkedHashSet<>();
        indexMembers.add("10");
        when(setOperations.members("byai:chat:runtime:index")).thenReturn(indexMembers);
        when(valueOperations.get("byai:chat:runtime:10")).thenReturn("not-a-json");
        when(redisTemplate.hasKey("byai:chat:runtime:10")).thenReturn(true);

        List<ChatRuntimeState> states = service.listRunningStates();

        assertEquals(0, states.size());
        verify(setOperations, never()).remove(anyString(), any(Object.class));
    }

    private ChatRuntimeState runtimeState(ByaiMessageHotDtoDto askMsg) {
        ChatRuntimeState state = new ChatRuntimeState();
        state.setSessionId(10L);
        state.setTraceId("trace-1");
        state.setUserMessageId(100L);
        state.setModelAnswerMessageId(101L);
        state.setTaskId(300L);
        state.setUserId(200L);
        state.setAssistantChatDto(assistantChatDto());
        state.setAskMsg(askMsg);
        state.setToken("token");
        return state;
    }

    private AssistantChatDto assistantChatDto() {
        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setAgentType("001");
        assistantChatDto.setChatContent("hello");
        return assistantChatDto;
    }
}
