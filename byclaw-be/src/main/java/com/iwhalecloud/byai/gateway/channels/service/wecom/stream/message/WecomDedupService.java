package com.iwhalecloud.byai.gateway.channels.service.wecom.stream.message;

import com.iwhalecloud.byai.common.util.RedisUtil;
import org.springframework.stereotype.Service;

/**
 * Redis-backed dedup for WeCom callbacks, mirroring the DingTalk listener's
 * {@code setIfAbsent + TTL} approach (DingtalkBotListener.java:56-57,240-249).
 * Messages and events use SEPARATE key namespaces so a msgid collision across
 * the two streams cannot drop a live callback.
 */
@Service
public class WecomDedupService {

    static final String MSG_KEY_PREFIX = "wecom:stream:msg:";
    static final String EVT_KEY_PREFIX = "wecom:stream:evt:";
    static final long DEDUP_TTL_SECONDS = 30 * 60L;

    /** @return true if this msgid was seen before (should be skipped). */
    public boolean isDuplicateMessage(String msgId) {
        return isDuplicate(MSG_KEY_PREFIX, msgId);
    }

    /** @return true if this event msgid was seen before (should be skipped). */
    public boolean isDuplicateEvent(String msgId) {
        return isDuplicate(EVT_KEY_PREFIX, msgId);
    }

    private boolean isDuplicate(String prefix, String msgId) {
        if (msgId == null || msgId.isBlank()) {
            return false;
        }
        Boolean firstConsume = RedisUtil.setIfAbsent(prefix + msgId, "1", DEDUP_TTL_SECONDS);
        return Boolean.FALSE.equals(firstConsume);
    }
}
