package com.iwhalecloud.byai.state.domain.chat.service;

import java.net.InetAddress;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class RunningOutputStreamRegistry {

    private static final String KEY_PREFIX = "byai:chat:running:";

    private static final long RUNNING_TTL_SECONDS = 30 * 60L;

    private final String instanceId = buildInstanceId();

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    public void markRunning(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || ctx.modelAnswerMessageId == null) {
            return;
        }
        if (StringUtils.isBlank(ctx.runningOutputStreamToken)) {
            ctx.runningOutputStreamToken = UUID.randomUUID().toString();
        }

        JSONObject value = new JSONObject();
        value.put("instanceId", instanceId);
        value.put("token", ctx.runningOutputStreamToken);
        value.put("sessionId", ctx.sessionId);
        value.put("modelAnswerMessageId", ctx.modelAnswerMessageId);
        value.put("traceId", ctx.traceId);
        value.put("startedAt", System.currentTimeMillis());
        redisTemplate.opsForValue().set(buildKey(ctx.sessionId), value.toJSONString(), RUNNING_TTL_SECONDS,
            TimeUnit.SECONDS);
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
            }
        }
        catch (Exception e) {
            log.warn("释放运行中 OutputStream 标记失败, sessionId: {}", ctx.sessionId, e);
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

    private String buildKey(Long sessionId) {
        return KEY_PREFIX + sessionId;
    }

    private String buildInstanceId() {
        try {
            return InetAddress.getLocalHost().getHostName() + ":" + UUID.randomUUID();
        }
        catch (Exception e) {
            return UUID.randomUUID().toString();
        }
    }
}
