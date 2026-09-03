package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Objects;
import java.util.concurrent.TimeUnit;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.SessionRuntimeState;

import lombok.extern.slf4j.Slf4j;

/** Stores the latest generic parent-session runtime snapshot independently from a request marker. */
@Slf4j
@Service
public class SessionRuntimeStateService {

    private static final String KEY_PREFIX = "byai:chat:session-runtime:";

    private static final long RUNTIME_TTL_SECONDS = 24 * 60 * 60L;

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    public boolean isRuntimeEvent(JSONObject dataJson) {
        JSONObject metadata = dataJson == null ? null : dataJson.getJSONObject("metadata");
        return metadata != null
            && "session.runtime".equals(metadata.getString("event_kind"))
            && "parent".equals(metadata.getString("session_scope"));
    }

    /**
     * Applies a snapshot only when it moves the same source/trace forward, or belongs to a newer turn.
     * Returning {@code null} means the event was stale or malformed and must not be broadcast.
     */
    public synchronized SessionRuntimeState applyEvent(Long sessionId, JSONObject dataJson) {
        if (sessionId == null || !isRuntimeEvent(dataJson)) {
            return null;
        }
        try {
            SessionRuntimeState incoming = fromEvent(sessionId, dataJson);
            if (!isValid(incoming)) {
                return null;
            }
            SessionRuntimeState current = get(sessionId);
            if (!shouldReplace(current, incoming)) {
                return null;
            }
            redisTemplate.opsForValue().set(buildKey(sessionId), JSON.toJSONString(incoming),
                RUNTIME_TTL_SECONDS, TimeUnit.SECONDS);
            return incoming;
        }
        catch (Exception e) {
            log.warn("保存会话运行态失败, sessionId: {}, event: {}", sessionId, dataJson, e);
            return null;
        }
    }

    public SessionRuntimeState get(Long sessionId) {
        if (sessionId == null) {
            return null;
        }
        try {
            String value = (String)redisTemplate.opsForValue().get(buildKey(sessionId));
            return StringUtils.isBlank(value) ? null : JSON.parseObject(value, SessionRuntimeState.class);
        }
        catch (Exception e) {
            log.warn("读取会话运行态失败, sessionId: {}", sessionId, e);
            return null;
        }
    }

    private SessionRuntimeState fromEvent(Long sessionId, JSONObject dataJson) {
        JSONObject metadata = dataJson.getJSONObject("metadata");
        SessionRuntimeState state = new SessionRuntimeState();
        state.setSessionId(sessionId);
        state.setTraceId(dataJson.getString("trace_id"));
        state.setSource(metadata.getString("event_source"));
        state.setStatus(metadata.getString("session_status"));
        state.setRootActive(metadata.getBoolean("root_active"));
        state.setAcceptingInput(metadata.getBoolean("accepting_input"));
        state.setActiveAgentCount(metadata.getLong("active_agent_count"));
        state.setActiveChildCount(metadata.getLong("active_child_count"));
        state.setWaitingInteractionCount(metadata.getLong("waiting_interaction_count"));
        state.setRevision(metadata.getLong("runtime_revision"));
        state.setChangedAt(metadata.getLong("runtime_changed_at"));
        return state;
    }

    private boolean isValid(SessionRuntimeState state) {
        return state != null && StringUtils.isNotBlank(state.getTraceId())
            && StringUtils.isNotBlank(state.getStatus()) && state.getRevision() != null
            && state.getChangedAt() != null;
    }

    private boolean shouldReplace(SessionRuntimeState current, SessionRuntimeState incoming) {
        if (current == null) {
            return true;
        }
        if (Objects.equals(current.getSource(), incoming.getSource())
            && Objects.equals(current.getTraceId(), incoming.getTraceId())) {
            return current.getRevision() == null || incoming.getRevision() > current.getRevision();
        }
        return current.getChangedAt() == null || incoming.getChangedAt() >= current.getChangedAt();
    }

    private String buildKey(Long sessionId) {
        return KEY_PREFIX + sessionId;
    }
}
