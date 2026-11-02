package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * DSH 活动状态存储，所有后端实例共享。两个 Redis Hash，field 都是沙箱 workerId（{@code byclaw-dsh-<userCode>}）：
 * <ul>
 * <li>state：value 为 {@link DshActivity} 的 JSON，来自活动 Stream；</li>
 * <li>busy-heartbeat：value 为后端最近一次收到该沙箱 {@code worker:stats:dsh} busy 心跳的毫秒时间，
 * 用于在 Stream 静默时证明容器仍然活着。</li>
 * </ul>
 */
@Component
public class DshActivityStateStore {

    private static final Logger LOGGER = LoggerFactory.getLogger(DshActivityStateStore.class);

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    static final String DEFAULT_STATE_KEY = "byclaw:sandbox:dsh-activity:state";

    static final String DEFAULT_BUSY_HEARTBEAT_KEY = "byclaw:sandbox:dsh-activity:busy-heartbeat";

    /**
     * 比较 Stream ID 后写入，单 key 原子执行：多实例并发消费同一沙箱相邻两条上报时，旧的 releasable
     * 不能覆盖新的 busy。任一 ID 无法解析时照常写入。
     */
    private static final DefaultRedisScript<Long> RECORD_SCRIPT = new DefaultRedisScript<>("""
        local current = redis.call('hget', KEYS[1], ARGV[1])
        if current then
            local ok, stored = pcall(cjson.decode, current)
            if ok and type(stored) == 'table' and type(stored.streamId) == 'string' then
                local sm, ss = string.match(stored.streamId, '^(%d+)%-?(%d*)$')
                local nm, ns = string.match(ARGV[3], '^(%d+)%-?(%d*)$')
                if sm and nm then
                    sm, nm = tonumber(sm), tonumber(nm)
                    ss, ns = tonumber(ss) or 0, tonumber(ns) or 0
                    if nm < sm or (nm == sm and ns < ss) then return 0 end
                end
            end
        end
        redis.call('hset', KEYS[1], ARGV[1], ARGV[2])
        return 1
        """, Long.class);

    /** 仅当存储的仍是同一 Stream ID（或已无记录）时删除，单 key 原子执行。 */
    private static final DefaultRedisScript<Long> REMOVE_IF_UNCHANGED_SCRIPT = new DefaultRedisScript<>("""
        local current = redis.call('hget', KEYS[1], ARGV[1])
        if not current then return 1 end
        local ok, stored = pcall(cjson.decode, current)
        if ok and type(stored) == 'table' and stored.streamId ~= ARGV[2] then return 0 end
        redis.call('hdel', KEYS[1], ARGV[1])
        return 1
        """, Long.class);

    private final StringRedisTemplate stringRedisTemplate;

    @Value("${byclaw.sandbox.dsh-activity.state-key:" + DEFAULT_STATE_KEY + "}")
    private String stateKey = DEFAULT_STATE_KEY;

    @Value("${byclaw.sandbox.dsh-activity.busy-heartbeat-key:" + DEFAULT_BUSY_HEARTBEAT_KEY + "}")
    private String busyHeartbeatKey = DEFAULT_BUSY_HEARTBEAT_KEY;

    public DshActivityStateStore(StringRedisTemplate stringRedisTemplate) {
        this.stringRedisTemplate = stringRedisTemplate;
    }

    /**
     * 写入最新状态；已存储的记录 Stream ID 更新时放弃写入（多实例乱序消费）。比较与写入在 Redis 内原子执行。
     *
     * @return 是否写入
     */
    public boolean record(String workerId, DshActivity activity) {
        Long written = stringRedisTemplate.execute(RECORD_SCRIPT, List.of(stateKey), workerId, write(activity),
            StringUtils.defaultString(activity.streamId()));
        if (written == null || written == 0L) {
            LOGGER.debug("忽略乱序到达的 DSH 活动记录，workerId={}，streamId={}", workerId, activity.streamId());
            return false;
        }
        return true;
    }

    public DshActivity find(String workerId) {
        if (StringUtils.isBlank(workerId)) {
            return null;
        }
        Object value = stringRedisTemplate.opsForHash().get(stateKey, workerId);
        return value == null ? null : read(workerId, value.toString());
    }

    public Map<String, DshActivity> entries() {
        Map<Object, Object> values = stringRedisTemplate.opsForHash().entries(stateKey);
        Map<String, DshActivity> result = new LinkedHashMap<>();
        if (values == null) {
            return result;
        }
        values.forEach((field, value) -> {
            if (field == null || value == null) {
                return;
            }
            DshActivity activity = read(field.toString(), value.toString());
            if (activity != null) {
                result.put(field.toString(), activity);
            }
        });
        return result;
    }

    /** 沙箱释放后清理该 workerId 的活动状态和 busy 心跳时间。 */
    public void remove(String workerId) {
        if (StringUtils.isBlank(workerId)) {
            return;
        }
        stringRedisTemplate.opsForHash().delete(stateKey, workerId);
        stringRedisTemplate.opsForHash().delete(busyHeartbeatKey, workerId);
    }

    /** 记录后端收到该沙箱 {@code worker:stats:dsh} busy 心跳的时间。 */
    public void touchBusyHeartbeat(String workerId, long nowMillis) {
        if (StringUtils.isBlank(workerId)) {
            return;
        }
        stringRedisTemplate.opsForHash().put(busyHeartbeatKey, workerId, Long.toString(nowMillis));
    }

    /**
     * 后端最近一次收到该沙箱 busy 心跳的时间。
     *
     * @return 毫秒时间戳；从未收到或无法解析时返回 0
     */
    public long busyHeartbeatAt(String workerId) {
        if (StringUtils.isBlank(workerId)) {
            return 0L;
        }
        Object value = stringRedisTemplate.opsForHash().get(busyHeartbeatKey, workerId);
        if (value == null) {
            return 0L;
        }
        try {
            return Long.parseLong(value.toString());
        }
        catch (NumberFormatException e) {
            LOGGER.warn("DSH busy 心跳时间无法解析，按未收到处理，workerId={}，value={}", workerId, value);
            return 0L;
        }
    }

    /**
     * 仅当存储的仍是同一条记录时删除，避免删掉刚到达的新上报；比较与删除在 Redis 内原子执行。
     *
     * @return 是否删除（已无记录也视为删除）
     */
    public boolean removeIfUnchanged(String workerId, DshActivity expected) {
        if (StringUtils.isBlank(workerId) || expected == null) {
            return false;
        }
        Long removed = stringRedisTemplate.execute(REMOVE_IF_UNCHANGED_SCRIPT, List.of(stateKey), workerId,
            StringUtils.defaultString(expected.streamId()));
        return removed != null && removed == 1L;
    }

    private String write(DshActivity activity) {
        try {
            return OBJECT_MAPPER.writeValueAsString(activity);
        }
        catch (Exception e) {
            throw new IllegalStateException("DSH 活动状态序列化失败", e);
        }
    }

    /** 无法解析的值按未上报处理，保持原有空闲释放规则。 */
    private DshActivity read(String workerId, String value) {
        try {
            DshActivity activity = OBJECT_MAPPER.readValue(value, DshActivity.class);
            if (activity == null || StringUtils.isBlank(activity.userCode())) {
                LOGGER.warn("DSH 活动状态缺少 userCode，按未上报处理，workerId={}", workerId);
                return null;
            }
            return activity;
        }
        catch (Exception e) {
            LOGGER.warn("DSH 活动状态解析失败，按未上报处理，workerId={}，reason={}", workerId, e.getMessage());
            return null;
        }
    }
}
