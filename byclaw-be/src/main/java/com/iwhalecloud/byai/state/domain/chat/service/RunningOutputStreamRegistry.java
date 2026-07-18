package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class RunningOutputStreamRegistry {

    private static final String KEY_PREFIX = "byai:chat:running:";

    private static final long RUNNING_TTL_SECONDS = 30 * 60L;

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private ChatRuntimeInstance chatRuntimeInstance;

    @Autowired
    private ChatRuntimeStateService chatRuntimeStateService;

    public String getInstanceId() {
        return chatRuntimeInstance == null ? "unknown" : chatRuntimeInstance.getInstanceId();
    }

    public void markRunning(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || ctx.modelAnswerMessageId == null) {
            return;
        }
        if (StringUtils.isBlank(ctx.runningOutputStreamToken)) {
            ctx.runningOutputStreamToken = UUID.randomUUID().toString();
        }

        JSONObject value = new JSONObject();
        value.put("instanceId", getInstanceId());
        value.put("token", ctx.runningOutputStreamToken);
        value.put("sessionId", ctx.sessionId);
        value.put("userMessageId", ctx.userMessageId);
        value.put("modelAnswerMessageId", ctx.modelAnswerMessageId);
        value.put("taskId", ctx.taskId);
        value.put("traceId", ctx.traceId);
        value.put("laneId", ctx.assistantChatDto == null ? null : ctx.assistantChatDto.getLaneId());
        value.put("clientRequestId", ctx.clientRequestId);
        value.put("transport", ctx.transport == null ? null : ctx.transport.name());
        value.put("startedAt", System.currentTimeMillis());
        value.put("lastHeartbeatAt", System.currentTimeMillis());
        if (ctx.assistantChatDto != null) {
            value.put("agentId", ctx.assistantChatDto.getAgentId());
            value.put("agentCode", ctx.assistantChatDto.getAgentCode());
            value.put("agentType", ctx.assistantChatDto.getAgentType());
            value.put("chatContent", ctx.assistantChatDto.getChatContent());
        }
        redisTemplate.opsForValue().set(buildKey(ctx.sessionId), value.toJSONString(), RUNNING_TTL_SECONDS,
            TimeUnit.SECONDS);
        if (chatRuntimeStateService != null) {
            chatRuntimeStateService.save(ctx, ctx.runningOutputStreamToken);
        }
    }

    public void touchRunning(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || StringUtils.isBlank(ctx.runningOutputStreamToken)) {
            return;
        }
        String key = buildKey(ctx.sessionId);
        String value = (String) redisTemplate.opsForValue().get(key);
        if (StringUtils.isBlank(value)) {
            return;
        }

        try {
            JSONObject running = JSON.parseObject(value);
            if (ctx.runningOutputStreamToken.equals(running.getString("token"))) {
                running.put("lastHeartbeatAt", System.currentTimeMillis());
                running.put("instanceId", getInstanceId());
                redisTemplate.opsForValue().set(key, running.toJSONString(), RUNNING_TTL_SECONDS, TimeUnit.SECONDS);
                redisTemplate.expire(key, RUNNING_TTL_SECONDS, TimeUnit.SECONDS);
                if (chatRuntimeStateService != null) {
                    chatRuntimeStateService.touch(ctx);
                }
            }
        }
        catch (Exception e) {
            log.warn("刷新运行中 OutputStream 标记失败, sessionId: {}", ctx.sessionId, e);
        }
    }

    public void releaseIfOwner(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || StringUtils.isBlank(ctx.runningOutputStreamToken)) {
            return;
        }
        String key = buildKey(ctx.sessionId);
        String value = (String) redisTemplate.opsForValue().get(key);
        if (StringUtils.isBlank(value)) {
            return;
        }

        try {
            JSONObject running = JSON.parseObject(value);
            if (ctx.runningOutputStreamToken.equals(running.getString("token"))) {
                redisTemplate.delete(key);
                if (chatRuntimeStateService != null) {
                    chatRuntimeStateService.delete(ctx);
                }
            }
        }
        catch (Exception e) {
            log.warn("释放运行中 OutputStream 标记失败, sessionId: {}", ctx.sessionId, e);
        }
    }

    public void release(Long sessionId, Long modelAnswerMessageId) {
        if (sessionId == null) {
            return;
        }
        String key = buildKey(sessionId);
        if (modelAnswerMessageId == null) {
            redisTemplate.delete(key);
            if (chatRuntimeStateService != null) {
                chatRuntimeStateService.delete(sessionId);
            }
            return;
        }

        String value = (String) redisTemplate.opsForValue().get(key);
        if (StringUtils.isBlank(value)) {
            return;
        }

        try {
            JSONObject running = JSON.parseObject(value);
            if (modelAnswerMessageId.equals(running.getLong("modelAnswerMessageId"))) {
                redisTemplate.delete(key);
                if (chatRuntimeStateService != null) {
                    chatRuntimeStateService.delete(sessionId);
                }
            }
        }
        catch (Exception e) {
            log.warn("释放运行中 OutputStream 标记失败, sessionId: {}", sessionId, e);
        }
    }

    public boolean isRunning(Long sessionId, Long modelAnswerMessageId) {
        if (sessionId == null || modelAnswerMessageId == null) {
            return false;
        }

        String value = (String) redisTemplate.opsForValue().get(buildKey(sessionId));
        if (StringUtils.isBlank(value)) {
            return false;
        }

        try {
            JSONObject running = JSON.parseObject(value);
            return modelAnswerMessageId.equals(running.getLong("modelAnswerMessageId"));
        }
        catch (Exception e) {
            log.warn("解析运行中 OutputStream 标记失败, sessionId: {}", sessionId, e);
            return false;
        }
    }

    public RunningChatInfo getRunning(Long sessionId) {
        RunningChatInfo empty = new RunningChatInfo();
        empty.setSessionId(sessionId);
        empty.setRunning(false);
        if (sessionId == null) {
            return empty;
        }

        String key = buildKey(sessionId);
        String value = (String) redisTemplate.opsForValue().get(key);
        if (StringUtils.isBlank(value)) {
            return empty;
        }

        try {
            JSONObject running = JSON.parseObject(value);
            RunningChatInfo info = new RunningChatInfo();
            info.setSessionId(running.getLong("sessionId"));
            info.setRunning(true);
            info.setTraceId(running.getString("traceId"));
            info.setLaneId(running.getString("laneId"));
            info.setUserMessageId(running.getLong("userMessageId"));
            info.setClientRequestId(running.getString("clientRequestId"));
            info.setModelAnswerMessageId(running.getLong("modelAnswerMessageId"));
            info.setTaskId(running.getLong("taskId"));
            info.setTransport(running.getString("transport"));
            info.setStartedAt(running.getLong("startedAt"));
            info.setAgentId(running.getLong("agentId"));
            info.setAgentCode(running.getString("agentCode"));
            info.setAgentType(running.getString("agentType"));
            info.setChatContent(running.getString("chatContent"));
            Long ttl = redisTemplate.getExpire(key, TimeUnit.SECONDS);
            info.setTtlSeconds(ttl == null ? null : ttl);
            return info;
        }
        catch (Exception e) {
            log.warn("解析运行中 OutputStream 标记失败, sessionId: {}", sessionId, e);
            return empty;
        }
    }

    public List<RunningChatInfo> batchGetRunning(Collection<Long> sessionIds) {
        if (sessionIds == null || sessionIds.isEmpty()) {
            return Collections.emptyList();
        }
        return sessionIds.stream().map(this::getRunning).collect(Collectors.toList());
    }

    private String buildKey(Long sessionId) {
        return KEY_PREFIX + sessionId;
    }
}
