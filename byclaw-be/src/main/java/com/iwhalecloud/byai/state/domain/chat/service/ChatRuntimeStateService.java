package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.constants.chat.ChatObjType;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatTransport;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class ChatRuntimeStateService {

    private static final String RUNTIME_KEY_PREFIX = "byai:chat:runtime:";

    private static final String RECOVERY_LOCK_PREFIX = "byai:chat:recovery-lock:";

    private static final long RUNTIME_TTL_SECONDS = 24 * 60 * 60L;

    private static final long RECOVERY_LOCK_TTL_SECONDS = 120L;

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private ChatRuntimeInstance chatRuntimeInstance;

    public void save(ChatProcessContext ctx, String token) {
        if (ctx == null || ctx.sessionId == null || StringUtils.isBlank(ctx.traceId)
            || ctx.modelAnswerMessageId == null) {
            return;
        }
        try {
            ChatRuntimeState state = new ChatRuntimeState();
            state.setSessionId(ctx.sessionId);
            state.setTraceId(ctx.traceId);
            state.setUserMessageId(ctx.userMessageId);
            state.setModelAnswerMessageId(ctx.modelAnswerMessageId);
            state.setTaskId(ctx.taskId);
            state.setUserId(ctx.userId);
            state.setAssistantChatDto(ctx.assistantChatDto);
            state.setAskMsg(ctx.askMsg);
            state.setLoginInfo(ctx.loginInfo);
            state.setTargetAgentType(ctx.targetAgentType);
            state.setTransport(ctx.transport == null ? null : ctx.transport.name());
            state.setClientRequestId(ctx.clientRequestId);
            state.setOwnerInstanceId(chatRuntimeInstance.getInstanceId());
            state.setToken(StringUtils.defaultIfBlank(token, UUID.randomUUID().toString()));
            state.setStartedAt(System.currentTimeMillis());
            state.setLastHeartbeatAt(System.currentTimeMillis());
            state.setStatus(ChatRuntimeState.STATUS_RUNNING);
            redisTemplate.opsForValue().set(buildKey(ctx.sessionId), JSON.toJSONString(state), RUNTIME_TTL_SECONDS,
                TimeUnit.SECONDS);
        }
        catch (Exception e) {
            log.warn("保存聊天运行态失败, sessionId: {}, traceId: {}", ctx.sessionId, ctx.traceId, e);
        }
    }

    public void touch(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || StringUtils.isBlank(ctx.runningOutputStreamToken)) {
            return;
        }
        ChatRuntimeState state = get(ctx.sessionId);
        if (state == null || !ctx.runningOutputStreamToken.equals(state.getToken())) {
            return;
        }
        state.setLastHeartbeatAt(System.currentTimeMillis());
        state.setOwnerInstanceId(chatRuntimeInstance.getInstanceId());
        redisTemplate.opsForValue().set(buildKey(ctx.sessionId), JSON.toJSONString(state), RUNTIME_TTL_SECONDS,
            TimeUnit.SECONDS);
    }

    public ChatRuntimeState get(Long sessionId) {
        if (sessionId == null) {
            return null;
        }
        String value = (String) redisTemplate.opsForValue().get(buildKey(sessionId));
        if (StringUtils.isBlank(value)) {
            return null;
        }
        try {
            return JSON.parseObject(value, ChatRuntimeState.class);
        }
        catch (Exception e) {
            log.warn("解析聊天运行态失败, sessionId: {}", sessionId, e);
            return null;
        }
    }

    public ChatRuntimeState get(String sessionId) {
        try {
            return StringUtils.isBlank(sessionId) ? null : get(Long.valueOf(sessionId));
        }
        catch (Exception e) {
            return null;
        }
    }

    public List<ChatRuntimeState> listRunningStates() {
        List<ChatRuntimeState> states = new ArrayList<>();
        ScanOptions options = ScanOptions.scanOptions().match(RUNTIME_KEY_PREFIX + "*").count(100).build();
        try (Cursor<String> cursor = redisTemplate.scan(options)) {
            while (cursor != null && cursor.hasNext()) {
                String key = cursor.next();
                String value = (String) redisTemplate.opsForValue().get(key);
                if (StringUtils.isBlank(value)) {
                    continue;
                }
                try {
                    ChatRuntimeState state = JSON.parseObject(value, ChatRuntimeState.class);
                    if (state != null && ChatRuntimeState.STATUS_RUNNING.equals(state.getStatus())) {
                        states.add(state);
                    }
                }
                catch (Exception e) {
                    log.warn("解析聊天运行态失败, key: {}", key, e);
                }
            }
        }
        catch (Exception e) {
            log.warn("扫描聊天运行态失败", e);
        }
        return states;
    }

    public boolean tryAcquireRecoveryLock(Long sessionId) {
        if (sessionId == null) {
            return false;
        }
        Boolean success = redisTemplate.opsForValue()
            .setIfAbsent(buildRecoveryLockKey(sessionId), chatRuntimeInstance.getInstanceId(),
                RECOVERY_LOCK_TTL_SECONDS, TimeUnit.SECONDS);
        return Boolean.TRUE.equals(success);
    }

    public void delete(ChatProcessContext ctx) {
        if (ctx != null) {
            delete(ctx.sessionId);
        }
    }

    public void delete(Long sessionId) {
        if (sessionId != null) {
            redisTemplate.delete(buildKey(sessionId));
        }
    }

    public ChatProcessContext buildRecoveryContext(ChatRuntimeState state, RunningChatSnapshotService snapshotService) {
        if (state == null || state.getSessionId() == null || state.getAssistantChatDto() == null) {
            return null;
        }
        ChatProcessContext ctx = new ChatProcessContext(null, state.getAssistantChatDto());
        ctx.sessionId = state.getSessionId();
        ctx.traceId = state.getTraceId();
        ctx.userMessageId = state.getUserMessageId();
        ctx.modelAnswerMessageId = state.getModelAnswerMessageId();
        ctx.taskId = state.getTaskId();
        ctx.userId = state.getUserId();
        ctx.askMsg = resolveAskMsg(state);
        ctx.loginInfo = state.getLoginInfo();
        ctx.targetAgentType = state.getTargetAgentType();
        ctx.params = new HashMap<>();
        ctx.clientRequestId = state.getClientRequestId();
        ctx.transport = ChatTransport.WEBSOCKET;
        ctx.recoveryOnly = true;
        ctx.runningOutputStreamToken = state.getToken();
        String[] watermarkHolder = new String[1];
        ctx.messageContext = snapshotService.hydrateMessageContext(state, watermarkHolder);
        ctx.hydratedStreamId = watermarkHolder[0];
        if (ctx.messageContext == null) {
            ctx.messageContext = new com.iwhalecloud.byai.state.domain.chat.model.MessageContext(
                com.iwhalecloud.byai.state.common.enums.AgentTypeEnum.getNameCode(
                    state.getAssistantChatDto().getAgentType()),
                state.getModelAnswerMessageId(),
                state.getTaskId());
        }
        return ctx;
    }

    private ByaiMessageHotDtoDto resolveAskMsg(ChatRuntimeState state) {
        if (state.getAskMsg() != null) {
            return state.getAskMsg();
        }
        ByaiMessageHotDtoDto askMsg = new ByaiMessageHotDtoDto();
        askMsg.setSessionId(state.getSessionId());
        askMsg.setMessageId(state.getUserMessageId());
        askMsg.setMessageContent(state.getAssistantChatDto().getChatContent());
        askMsg.setCreateTime(state.getStartedAt() == null ? new Date() : new Date(state.getStartedAt()));
        askMsg.setObjId(state.getUserId());
        askMsg.setObjType(ChatObjType.HUMAN);
        askMsg.setCreatorId(state.getUserId());
        askMsg.setUsage(ChatUseageEnum.USER_INPUT.getCode());
        return askMsg;
    }

    private String buildKey(Long sessionId) {
        return RUNTIME_KEY_PREFIX + sessionId;
    }

    private String buildRecoveryLockKey(Long sessionId) {
        return RECOVERY_LOCK_PREFIX + sessionId;
    }
}
