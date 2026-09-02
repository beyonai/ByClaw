package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
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

    private static final String RUNTIME_INDEX_KEY = "byai:chat:runtime:index";

    private static final String RECOVERY_LOCK_PREFIX = "byai:chat:recovery-lock:";

    private static final long RUNTIME_TTL_SECONDS = 24 * 60 * 60L;

    private static final long RECOVERY_LOCK_TTL_SECONDS = 120L;

    /** 心跳与关闭交接都用单 key Lua 更新，避免关闭线程和最后一次 keepalive 相互覆盖。 */
    private static final DefaultRedisScript<Long> TOUCH_SCRIPT = new DefaultRedisScript<>("""
        local current = redis.call('get', KEYS[1])
        if not current then return 0 end
        local ok, state = pcall(cjson.decode, current)
        if not ok or state.token ~= ARGV[1] or state.status ~= 'RUNNING' then return 0 end
        state.ownerInstanceId = ARGV[2]
        state.lastHeartbeatAt = tonumber(ARGV[3])
        redis.call('set', KEYS[1], cjson.encode(state), 'EX', ARGV[4])
        return 1
        """, Long.class);

    private static final DefaultRedisScript<Long> REQUEST_HANDOFF_SCRIPT = new DefaultRedisScript<>("""
        local current = redis.call('get', KEYS[1])
        if not current then return 0 end
        local ok, state = pcall(cjson.decode, current)
        if not ok or state.token ~= ARGV[1] or state.ownerInstanceId ~= ARGV[2]
            or state.status ~= 'RUNNING' then return 0 end
        state.status = 'HANDOFF_REQUESTED'
        state.handoffRequestedAt = tonumber(ARGV[3])
        redis.call('set', KEYS[1], cjson.encode(state), 'EX', ARGV[4])
        return 1
        """, Long.class);

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
            redisTemplate.opsForSet().add(RUNTIME_INDEX_KEY, String.valueOf(ctx.sessionId));
        }
        catch (Exception e) {
            log.warn("保存聊天运行态失败, sessionId: {}, traceId: {}", ctx.sessionId, ctx.traceId, e);
        }
    }

    public void touch(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || StringUtils.isBlank(ctx.runningOutputStreamToken)) {
            return;
        }
        Long updated = redisTemplate.execute(TOUCH_SCRIPT, List.of(buildKey(ctx.sessionId)),
            ctx.runningOutputStreamToken, chatRuntimeInstance.getInstanceId(), String.valueOf(System.currentTimeMillis()),
            String.valueOf(RUNTIME_TTL_SECONDS));
        if (updated != null && updated > 0) {
            redisTemplate.opsForSet().add(RUNTIME_INDEX_KEY, String.valueOf(ctx.sessionId));
        }
    }

    /**
     * 将当前实例持有的会话原子标记为可交接。token 与 owner 双重校验可防止旧 Pod 覆盖新 Pod 已接管的状态。
     */
    public boolean requestHandoff(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || StringUtils.isBlank(ctx.runningOutputStreamToken)) {
            return false;
        }
        try {
            Long updated = redisTemplate.execute(REQUEST_HANDOFF_SCRIPT, List.of(buildKey(ctx.sessionId)),
                ctx.runningOutputStreamToken, chatRuntimeInstance.getInstanceId(),
                String.valueOf(System.currentTimeMillis()), String.valueOf(RUNTIME_TTL_SECONDS));
            if (updated != null && updated > 0) {
                redisTemplate.opsForSet().add(RUNTIME_INDEX_KEY, String.valueOf(ctx.sessionId));
                return true;
            }
        }
        catch (Exception e) {
            log.warn("标记聊天运行态交接失败, sessionId: {}, traceId: {}", ctx.sessionId, ctx.traceId, e);
        }
        return false;
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
        try {
            Set<Object> sessionIds = redisTemplate.opsForSet().members(RUNTIME_INDEX_KEY);
            if (sessionIds == null || sessionIds.isEmpty()) {
                return states;
            }
            for (Object sessionId : sessionIds) {
                ChatRuntimeState state = get(String.valueOf(sessionId));
                if (state == null) {
                    // 只有运行态 key 确实不存在才剔除索引：get() 对解析异常同样返回 null，
                    // 若一并剔除，一次瞬时反序列化失败就会让该会话永久无法被恢复扫描发现。
                    if (!runtimeStateExists(sessionId)) {
                        redisTemplate.opsForSet().remove(RUNTIME_INDEX_KEY, sessionId);
                    }
                    continue;
                }
                if (ChatRuntimeState.STATUS_RUNNING.equals(state.getStatus())
                    || ChatRuntimeState.STATUS_HANDOFF_REQUESTED.equals(state.getStatus())) {
                    states.add(state);
                }
                else {
                    redisTemplate.opsForSet().remove(RUNTIME_INDEX_KEY, sessionId);
                }
            }
        }
        catch (Exception e) {
            log.warn("列出聊天运行态失败", e);
        }
        return states;
    }

    private boolean runtimeStateExists(Object sessionId) {
        try {
            return Boolean.TRUE.equals(redisTemplate.hasKey(RUNTIME_KEY_PREFIX + sessionId));
        }
        catch (Exception e) {
            // 探测失败按存在处理，宁可多留一轮索引，也不误删待恢复会话。
            log.warn("探测聊天运行态 key 失败, sessionId: {}", sessionId, e);
            return true;
        }
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
            redisTemplate.opsForSet().remove(RUNTIME_INDEX_KEY, String.valueOf(sessionId));
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
