package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.lifecycle;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import org.springframework.stereotype.Service;

import java.lang.management.ManagementFactory;
import java.util.UUID;

@Service
public class DingtalkConnectionLockService {

    private static final String LOCK_KEY_PREFIX = "dingtalk:stream:connection-lock:";

    private final long ttlSeconds;
    private final LeaseOperations leaseOperations;
    private final String instanceId;

    public DingtalkConnectionLockService(DingtalkStreamProperties properties) {
        this(properties, new RedisLeaseOperations(), ManagementFactory.getRuntimeMXBean().getName());
    }

    DingtalkConnectionLockService(
            DingtalkStreamProperties properties,
            LeaseOperations leaseOperations,
            String instanceId) {
        this.ttlSeconds = properties.getLifecycle().getLeaseTtlSeconds();
        this.leaseOperations = leaseOperations;
        this.instanceId = instanceId;
    }

    public String newOwnerToken() {
        return instanceId + ":" + UUID.randomUUID();
    }

    public boolean acquire(String robotCode, String ownerToken) {
        return leaseOperations.acquire(lockKey(robotCode), ownerToken, ttlSeconds);
    }

    public boolean renew(String robotCode, String ownerToken) {
        return leaseOperations.renew(lockKey(robotCode), ownerToken, ttlSeconds);
    }

    public boolean release(String robotCode, String ownerToken) {
        return leaseOperations.release(lockKey(robotCode), ownerToken);
    }

    public long ttlSeconds() {
        return ttlSeconds;
    }

    private String lockKey(String robotCode) {
        return LOCK_KEY_PREFIX + robotCode;
    }

    interface LeaseOperations {
        boolean acquire(String key, String token, long ttlSeconds);

        boolean renew(String key, String token, long ttlSeconds);

        boolean release(String key, String token);
    }

    private static final class RedisLeaseOperations implements LeaseOperations {
        @Override
        public boolean acquire(String key, String token, long ttlSeconds) {
            return Boolean.TRUE.equals(RedisUtil.lock(key, token, ttlSeconds));
        }

        @Override
        public boolean renew(String key, String token, long ttlSeconds) {
            return Boolean.TRUE.equals(RedisUtil.renewLock(key, token, ttlSeconds));
        }

        @Override
        public boolean release(String key, String token) {
            return Boolean.TRUE.equals(RedisUtil.releaseLock(key, token));
        }
    }
}
