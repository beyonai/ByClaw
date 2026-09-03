package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import java.util.List;
import java.util.Optional;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import com.iwhalecloud.byai.common.ecrypt.Sm4Util;

@Service
public class WeixinComponentTicketStore {
    private static final String KEY_PREFIX = "byclaw:weixin-open-platform:ticket:{";
    private static final String TICKET_FIELD = "verify_ticket_cipher";
    private static final String SAVE_IF_NEWER_LUA = """
        local current = redis.call('HGET', KEYS[1], 'event_create_time')
        if current and tonumber(current) >= tonumber(ARGV[1]) then
            return 0
        end
        redis.call('HSET', KEYS[1],
            'event_create_time', ARGV[1],
            'verify_ticket_cipher', ARGV[2],
            'received_time', ARGV[3])
        return 1
        """;
    private static final RedisScript<Long> SAVE_IF_NEWER_SCRIPT =
        new DefaultRedisScript<>(SAVE_IF_NEWER_LUA, Long.class);

    private final StringRedisTemplate redisTemplate;

    public WeixinComponentTicketStore(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public boolean saveIfNewer(String componentAppid, String verifyTicket, long eventCreateTime) {
        requireText(componentAppid, "componentAppid", 128);
        requireText(verifyTicket, "verifyTicket");
        if (eventCreateTime <= 0) {
            throw new IllegalArgumentException("eventCreateTime must be positive");
        }
        String cipher = Sm4Util.encrypt(verifyTicket);
        Long result = redisTemplate.execute(
            SAVE_IF_NEWER_SCRIPT,
            List.of(key(componentAppid)),
            Long.toString(eventCreateTime),
            cipher,
            Long.toString(System.currentTimeMillis()));
        if (result == null) {
            throw new IllegalStateException("Weixin component ticket Redis update failed");
        }
        return result == 1L;
    }

    public Optional<String> findCurrent(String componentAppid) {
        requireText(componentAppid, "componentAppid", 128);
        Object value = redisTemplate.opsForHash().get(key(componentAppid), TICKET_FIELD);
        if (!(value instanceof String cipher) || !StringUtils.hasText(cipher)) {
            return Optional.empty();
        }
        return Optional.of(Sm4Util.decrypt(cipher));
    }

    private String key(String componentAppid) {
        return KEY_PREFIX + componentAppid + "}";
    }

    private void requireText(String value, String field) {
        requireText(value, field, 4096);
    }

    private void requireText(String value, String field, int maxLength) {
        if (!StringUtils.hasText(value) || value.length() > maxLength) {
            throw new IllegalArgumentException(field + " is invalid");
        }
    }
}
