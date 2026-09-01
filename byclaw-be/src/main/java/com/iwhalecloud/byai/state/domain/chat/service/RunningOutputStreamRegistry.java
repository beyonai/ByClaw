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
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.dto.SessionRuntimeState;

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

    @Autowired
    private SessionRuntimeStateService sessionRuntimeStateService;

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

    /**
     * 按本轮回答的归属释放运行态。
     * <p>
     * 释放动作会连带删除 {@link ChatRuntimeStateService} 的运行态，而重启恢复扫描完全依赖该运行态定位
     * 需要接管的会话，因此这里必须先证明「要停的正是当前这一轮」再删除：
     * <ul>
     *   <li>{@code modelAnswerMessageId} 为空表示调用方未能识别出任何一轮回答（stopChat 既没有 messageId，
     *     traceId 也解析失败），此时无法证明归属，保留运行态交由恢复扫描处理，而不是把它抹掉；</li>
     *   <li>running 标记已不存在但运行态仍在（例如 running 标记 TTL 先到期）时，改用运行态自身记录的
     *     modelAnswerMessageId 做归属校验，避免上一条留下永不回收的残留。</li>
     * </ul>
     *
     * @param sessionId 会话 ID
     * @param modelAnswerMessageId 本次停止对应的回答消息 ID，为空表示归属未知
     */
    public void release(Long sessionId, Long modelAnswerMessageId) {
        if (sessionId == null) {
            return;
        }
        if (modelAnswerMessageId == null) {
            log.info("stopChat 未能识别本轮回答，保留运行态以便重启恢复扫描接管, sessionId: {}", sessionId);
            return;
        }

        String key = buildKey(sessionId);
        String value = (String) redisTemplate.opsForValue().get(key);
        if (StringUtils.isBlank(value)) {
            releaseRuntimeStateIfSameAnswer(sessionId, modelAnswerMessageId);
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

    /**
     * running 标记已消失时的补偿清理：只有运行态记录的正是同一轮回答才删除。
     */
    private void releaseRuntimeStateIfSameAnswer(Long sessionId, Long modelAnswerMessageId) {
        if (chatRuntimeStateService == null) {
            return;
        }
        ChatRuntimeState state = chatRuntimeStateService.get(sessionId);
        if (state != null && modelAnswerMessageId.equals(state.getModelAnswerMessageId())) {
            chatRuntimeStateService.delete(sessionId);
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

        SessionRuntimeState sessionRuntime = sessionRuntimeStateService == null
            ? null : sessionRuntimeStateService.get(sessionId);

        String key = buildKey(sessionId);
        String value = (String) redisTemplate.opsForValue().get(key);
        if (StringUtils.isBlank(value)) {
            return applySessionRuntime(empty, sessionRuntime);
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
            return applySessionRuntime(info, sessionRuntime);
        }
        catch (Exception e) {
            log.warn("解析运行中 OutputStream 标记失败, sessionId: {}", sessionId, e);
            return applySessionRuntime(empty, sessionRuntime);
        }
    }

    private RunningChatInfo applySessionRuntime(RunningChatInfo info, SessionRuntimeState runtime) {
        if (runtime == null) {
            return info;
        }
        info.setRuntimeStatus(runtime.getStatus());
        info.setRuntimeSource(runtime.getSource());
        info.setActiveAgentCount(runtime.getActiveAgentCount());
        info.setActiveChildCount(runtime.getActiveChildCount());
        info.setWaitingInteractionCount(runtime.getWaitingInteractionCount());
        info.setRuntimeRevision(runtime.getRevision());
        info.setRuntimeChangedAt(runtime.getChangedAt());
        if (runtime.isActive()) {
            info.setRunning(true);
            info.setTraceId(StringUtils.defaultIfBlank(info.getTraceId(), runtime.getTraceId()));
            if (StringUtils.isBlank(info.getClientRequestId())) {
                info.setClientRequestId("runtime:" + info.getSessionId() + ":" + runtime.getTraceId());
            }
        }
        return info;
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
