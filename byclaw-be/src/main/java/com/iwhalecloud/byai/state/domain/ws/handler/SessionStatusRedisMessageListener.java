package com.iwhalecloud.byai.state.domain.ws.handler;

import java.nio.charset.StandardCharsets;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.state.domain.chat.service.SessionStreamManager;

import lombok.extern.slf4j.Slf4j;

/**
 * 监听 Session 状态 Key 的 keyspace 通知，并把当前状态推送到 WebSocket。
 */
@Slf4j
@Component
public class SessionStatusRedisMessageListener implements MessageListener {

    private static final String SET_EVENT = "set";

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private SessionStreamManager sessionStreamManager;

    @Override
    public void onMessage(Message message, byte[] pattern) {
        if (message == null || message.getBody() == null || message.getChannel() == null) {
            return;
        }
        String event = new String(message.getBody(), StandardCharsets.UTF_8);
        if (!SET_EVENT.equalsIgnoreCase(event)) {
            return;
        }

        String statusKey = extractStatusKey(new String(message.getChannel(), StandardCharsets.UTF_8));
        String sessionId = extractSessionId(statusKey);
        if (StringUtils.isBlank(sessionId)) {
            return;
        }

        try {
            Object statusValue = redisTemplate.opsForValue().get(statusKey);
            if (statusValue == null) {
                return;
            }
            sessionStreamManager.dispatchSessionStatusChange(sessionId, String.valueOf(statusValue));
        }
        catch (Exception e) {
            log.warn("处理 Session 状态 Key 变更失败, key: {}", statusKey, e);
        }
    }

    private String extractStatusKey(String channel) {
        if (StringUtils.isBlank(channel)) {
            return null;
        }
        int index = channel.indexOf(SessionStreamManager.SESSION_STATUS_KEY_PREFIX);
        return index < 0 ? null : channel.substring(index);
    }

    private String extractSessionId(String statusKey) {
        if (!StringUtils.startsWith(statusKey, SessionStreamManager.SESSION_STATUS_KEY_PREFIX)
            || !StringUtils.endsWith(statusKey, SessionStreamManager.SESSION_STATUS_KEY_SUFFIX)) {
            return null;
        }
        return StringUtils.substringBetween(statusKey, SessionStreamManager.SESSION_STATUS_KEY_PREFIX,
            SessionStreamManager.SESSION_STATUS_KEY_SUFFIX);
    }
}
