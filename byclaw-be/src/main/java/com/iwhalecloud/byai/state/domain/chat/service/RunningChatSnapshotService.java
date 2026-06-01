package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Date;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.chat.model.MessageResourceDto;
import com.iwhalecloud.byai.state.domain.message.enums.MsgStatus;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class RunningChatSnapshotService {

    private static final String KEY_PREFIX = "byai:chat:running:snapshot:";

    private static final long SNAPSHOT_TTL_SECONDS = 30 * 60L;

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    public void save(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || ctx.messageContext == null || ctx.modelAnswerMessageId == null
            || StringUtils.isBlank(ctx.traceId)) {
            return;
        }

        try {
            RunningChatSnapshotResponse snapshot = buildSnapshot(ctx);
            redisTemplate.opsForValue().set(buildKey(ctx.sessionId, ctx.traceId, ctx.modelAnswerMessageId),
                JSON.toJSONString(snapshot), SNAPSHOT_TTL_SECONDS, TimeUnit.SECONDS);
        }
        catch (Exception e) {
            log.warn("保存运行中会话快照失败, sessionId: {}, traceId: {}", ctx.sessionId, ctx.traceId, e);
        }
    }

    public RunningChatSnapshotResponse get(Long sessionId, String traceId, Long modelAnswerMessageId) {
        if (sessionId == null) {
            return null;
        }

        String value = null;
        if (StringUtils.isNotBlank(traceId) || modelAnswerMessageId != null) {
            value = (String) redisTemplate.opsForValue().get(buildKey(sessionId, traceId, modelAnswerMessageId));
        }

        if (StringUtils.isBlank(value)) {
            value = findBySession(sessionId);
        }
        if (StringUtils.isBlank(value)) {
            return null;
        }

        try {
            return JSON.parseObject(value, RunningChatSnapshotResponse.class);
        }
        catch (Exception e) {
            log.warn("解析运行中会话快照失败, sessionId: {}, traceId: {}", sessionId, traceId, e);
            return null;
        }
    }

    public void touch(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || ctx.modelAnswerMessageId == null || StringUtils.isBlank(ctx.traceId)) {
            return;
        }
        redisTemplate.expire(buildKey(ctx.sessionId, ctx.traceId, ctx.modelAnswerMessageId), SNAPSHOT_TTL_SECONDS,
            TimeUnit.SECONDS);
    }

    public void delete(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || ctx.modelAnswerMessageId == null || StringUtils.isBlank(ctx.traceId)) {
            return;
        }
        redisTemplate.delete(buildKey(ctx.sessionId, ctx.traceId, ctx.modelAnswerMessageId));
    }

    public void delete(Long sessionId, Long modelAnswerMessageId) {
        if (sessionId == null) {
            return;
        }
        deleteBySession(sessionId, modelAnswerMessageId);
    }

    private RunningChatSnapshotResponse buildSnapshot(ChatProcessContext ctx) {
        MessageContext messageContext = ctx.messageContext;
        RunningChatSnapshotResponse snapshot = new RunningChatSnapshotResponse();
        snapshot.setRunning(true);
        snapshot.setTraceId(ctx.traceId);
        snapshot.setRequestId(ctx.requestId);
        snapshot.setModelAnswerMessageId(ctx.modelAnswerMessageId);
        snapshot.setMessageId(ctx.modelAnswerMessageId);
        snapshot.setSessionId(ctx.sessionId);
        snapshot.setTaskId(ctx.taskId);
        snapshot.setUsage(ChatUseageEnum.SYSTEM_RESPONSE.getCode());
        snapshot.setCreatorId(ctx.userId);
        snapshot.setMetadata(ctx.assistantChatDto == null ? null : ctx.assistantChatDto.getMetadata());
        snapshot.setCreateTime(new Date());
        snapshot.setMessageContent(messageContext.returnAnswerText());
        snapshot.setResComIds(messageContext.getResComIds());
        snapshot.setMsgStatus(MsgStatus.APPEND.getCode());
        snapshot.setAccessTerminal(ctx.assistantChatDto == null ? null : ctx.assistantChatDto.getAccessTerminal());

        if (CollectionUtils.isNotEmpty(messageContext.getAnswerMessageList())) {
            snapshot.setMessageStruct(JSON.toJSONString(messageContext.getAnswerMessageList()));
        }
        if (CollectionUtils.isNotEmpty(messageContext.getReasonMessageList())) {
            snapshot.setInferLog(JSON.toJSONString(messageContext.getReasonMessageList()));
        }

        MessageResourceDto messageResourceDto = new MessageResourceDto();
        messageResourceDto.setResources(messageContext.getChatRelatedResource());
        snapshot.setRelatedResources(JSON.toJSONString(messageResourceDto));
        return snapshot;
    }

    private String findBySession(Long sessionId) {
        String pattern = KEY_PREFIX + sessionId + ":*";
        try {
            Set<String> keys = redisTemplate.keys(pattern);
            if (keys == null || keys.isEmpty()) {
                return null;
            }
            return keys.stream()
                .findFirst()
                .map(key -> (String) redisTemplate.opsForValue().get(key))
                .orElse(null);
        }
        catch (Exception e) {
            log.warn("按 session 查询运行中会话快照失败, sessionId: {}", sessionId, e);
            return null;
        }
    }

    private void deleteBySession(Long sessionId, Long modelAnswerMessageId) {
        String pattern = KEY_PREFIX + sessionId + ":*";
        try {
            Set<String> keys = redisTemplate.keys(pattern);
            if (keys == null || keys.isEmpty()) {
                return;
            }
            if (modelAnswerMessageId == null) {
                redisTemplate.delete(keys);
                return;
            }
            keys.stream()
                .filter(key -> isSameMessage(key, modelAnswerMessageId))
                .forEach(redisTemplate::delete);
        }
        catch (Exception e) {
            log.warn("删除运行中会话快照失败, sessionId: {}", sessionId, e);
        }
    }

    private boolean isSameMessage(String key, Long modelAnswerMessageId) {
        String value = (String) redisTemplate.opsForValue().get(key);
        if (StringUtils.isBlank(value)) {
            return false;
        }
        try {
            RunningChatSnapshotResponse snapshot = JSON.parseObject(value, RunningChatSnapshotResponse.class);
            return modelAnswerMessageId.equals(snapshot.getModelAnswerMessageId());
        }
        catch (Exception e) {
            log.warn("解析运行中会话快照失败, key: {}", key, e);
            return false;
        }
    }

    private String buildKey(Long sessionId, String traceId, Long modelAnswerMessageId) {
        if (StringUtils.isNotBlank(traceId)) {
            return KEY_PREFIX + sessionId + ":" + traceId;
        }
        return KEY_PREFIX + sessionId + ":" + modelAnswerMessageId;
    }
}
