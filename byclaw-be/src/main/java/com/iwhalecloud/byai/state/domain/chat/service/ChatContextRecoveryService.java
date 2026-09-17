package com.iwhalecloud.byai.state.domain.chat.service;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class ChatContextRecoveryService {

    @Autowired
    private ChatRuntimeStateService chatRuntimeStateService;

    @Autowired
    private RunningChatSnapshotService runningChatSnapshotService;

    @Autowired
    private OutputStreamManager outputStreamManager;

    public ChatProcessContext recoverIfNecessary(JSONObject dataJson) {
        String sessionId = dataJson == null ? null : dataJson.getString("session_id");
        if (StringUtils.isBlank(sessionId)) {
            return null;
        }

        String traceId = dataJson.getString("trace_id");
        ChatProcessContext existing = outputStreamManager.getContext(sessionId, traceId);
        if (existing != null) {
            return existing;
        }

        ChatRuntimeState state = chatRuntimeStateService.get(sessionId, traceId);
        if (state == null || !ChatRuntimeState.STATUS_RUNNING.equals(state.getStatus())) {
            return null;
        }

        if (StringUtils.isNotBlank(traceId) && StringUtils.isNotBlank(state.getTraceId())
            && !traceId.equals(state.getTraceId())) {
            return null;
        }

        ChatProcessContext recovered = chatRuntimeStateService.buildRecoveryContext(state, runningChatSnapshotService);
        if (recovered == null) {
            return null;
        }
        outputStreamManager.putContext(sessionId, recovered);
        log.info("已恢复 Redis Stream 处理上下文, sessionId: {}, traceId: {}", sessionId, recovered.traceId);
        return recovered;
    }

    public ChatProcessContext recover(ChatRuntimeState state) {
        if (state == null || state.getSessionId() == null) {
            return null;
        }
        String sessionId = String.valueOf(state.getSessionId());
        ChatProcessContext existing = outputStreamManager.getContext(sessionId, state.getTraceId());
        if (existing != null) {
            return existing;
        }
        ChatProcessContext recovered = chatRuntimeStateService.buildRecoveryContext(state, runningChatSnapshotService);
        if (recovered != null) {
            outputStreamManager.putContext(sessionId, recovered);
        }
        return recovered;
    }
}
