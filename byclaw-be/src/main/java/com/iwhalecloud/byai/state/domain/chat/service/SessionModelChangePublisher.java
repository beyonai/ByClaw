package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;

/** 发布会话模型运行状态变化；Redis 中的状态记录始终是权威来源。 */
@Service
public class SessionModelChangePublisher {

    private static final Logger LOGGER = LoggerFactory.getLogger(SessionModelChangePublisher.class);

    private final StringRedisTemplate stringRedisTemplate;

    private final String channel;

    public SessionModelChangePublisher(StringRedisTemplate stringRedisTemplate,
        @Value("${byai.session-model-change.pubsub-channel:byai:pub:session_model_change}") String channel) {
        this.stringRedisTemplate = stringRedisTemplate;
        this.channel = channel;
    }

    /** 发布失败只记录日志，不能回滚已经写入的会话权威状态。 */
    public void publishQuietly(Long sessionId, long revision, List<String> changeMask) {
        JSONObject event = new JSONObject();
        event.put("eventType", "SESSION_MODEL_CHANGED");
        event.put("sessionId", String.valueOf(sessionId));
        event.put("userCode", CurrentUserHolder.getCurrentUserCode());
        event.put("revision", revision);
        event.put("changeMask", changeMask);
        event.put("changedAt", System.currentTimeMillis());
        event.put("source", "byclaw-be");
        try {
            stringRedisTemplate.convertAndSend(channel, JSON.toJSONString(event));
        }
        catch (RuntimeException e) {
            LOGGER.warn("发布会话模型变化事件失败, sessionId={}, revision={}: {}", sessionId, revision,
                e.getMessage());
        }
    }
}
