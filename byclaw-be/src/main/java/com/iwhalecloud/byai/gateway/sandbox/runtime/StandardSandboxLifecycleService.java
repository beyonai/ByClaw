package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.apache.commons.collections4.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest;
import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLifecycleFacade;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxSpecProcessor;

/**
 * Standard get-or-create lifecycle shared by AgentPool, OpenSandbox, WhaleAgent
 * and future sandbox runtimes.
 */
public class StandardSandboxLifecycleService implements SandboxLifecycleFacade {

    private static final Logger log = LoggerFactory.getLogger(StandardSandboxLifecycleService.class);
    private static final String REDIS_KEY_PREFIX = "byai:worker:sandbox:";
    private static final String REDIS_CREATE_LOCK_SUFFIX = ":create-lock";
    private static final String REDIS_EXPIRE_INDEX_KEY = "byai:worker:sandbox:expires";
    private static final String REDIS_USER_INDEX_PREFIX = "byai:worker:sandbox:user-index:";
    private static final long SANDBOX_INFO_TTL_MULTIPLIER = 2L;
    private static final int K8S_LABEL_VALUE_MAX_LEN = 63;

    private final SandboxProperties properties;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final SandboxServiceSpecRepository specRepository;
    private final SandboxSpecProcessor specProcessor;
    private final SandboxRuntimeProvider runtimeProvider;

    public StandardSandboxLifecycleService(SandboxProperties properties,
                                           StringRedisTemplate redisTemplate,
                                           SandboxServiceSpecRepository specRepository,
                                           SandboxSpecProcessor specProcessor,
                                           SandboxRuntimeProvider runtimeProvider) {
        this.properties = properties;
        this.redisTemplate = redisTemplate;
        this.specRepository = specRepository;
        this.specProcessor = specProcessor;
        this.runtimeProvider = runtimeProvider;
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        this.objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    @Override
    public SandboxResponse<SandboxLaunchData> launchSandbox(SandboxLaunchRequest request) {
        try {
            List<String> endpoints = createSandbox(request);
            SandboxLaunchData data = new SandboxLaunchData();
            data.setEndpoint(CollectionUtils.isNotEmpty(endpoints) ? endpoints.getFirst() : "");
            return SandboxResponse.success(data);
        } catch (Exception e) {
            log.error("Failed to launch sandbox by provider={}, user={}, type={}: {}",
                runtimeProvider.providerType(), request.getUserCode(), request.getSandboxType(), e.getMessage(), e);
            return SandboxResponse.error(e.getMessage());
        }
    }

    private List<String> createSandbox(SandboxLaunchRequest launchRequest) {
        String userCode = launchRequest.getUserCode();
        String sandboxType = launchRequest.getSandboxType();
        String redisKey = buildRedisKey(userCode, sandboxType);

        List<String> cached = readCachedEndpoints(redisKey, userCode, sandboxType);
        if (cached != null) {
            return cached;
        }

        SandboxServiceSpec spec = specRepository.findByServiceKey(sandboxType).orElse(null);
        if (spec == null) {
            throw new IllegalArgumentException("Unknown sandbox service key: " + sandboxType);
        }

        String lockKey = buildCreationLockKey(userCode, sandboxType);
        String lockToken = UUID.randomUUID().toString();
        Boolean gotLock = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, lockToken, Objects.requireNonNull(properties.getSandboxCreationLockTtl()));
        if (!Boolean.TRUE.equals(gotLock)) {
            List<String> afterContention = readCachedEndpoints(redisKey, userCode, sandboxType);
            if (afterContention != null) {
                return afterContention;
            }
            throw new IllegalStateException("沙箱正在创建中，请稍后重试: user=" + userCode + ", type=" + sandboxType);
        }

        try {
            List<String> doubleCheck = readCachedEndpoints(redisKey, userCode, sandboxType);
            if (doubleCheck != null) {
                return doubleCheck;
            }

            var request = specProcessor.buildCreateRequest(
                userCode, sandboxType, launchRequest.getEnvs(), launchRequest.getUserInfo(), spec);
            request.setTimeout(resolveTimeoutSeconds(request.getTimeout(), launchRequest.getAutoRelease()));
            String idempotencyKey = buildIdempotencyKey(userCode, sandboxType);

            SandboxRuntimeInstance instance = runtimeProvider.findReusable(userCode, sandboxType)
                .orElseGet(() -> runtimeProvider.create(request, spec, userCode, sandboxType, idempotencyKey));

            List<String> endpoints = runtimeProvider.resolveEndpoints(instance, spec, request);
            SandboxInfo info = SandboxInfo.builder()
                .sandboxId(instance.getSandboxId())
                .userCode(userCode)
                .sandboxType(sandboxType)
                .endpoints(endpoints)
                .endpointHeaders(runtimeProvider.resolveEndpointHeaders(instance))
                .timeoutSeconds(request.getTimeout())
                .createdTime(LocalDateTime.now())
                .lastHeartbeatTime(LocalDateTime.now())
                .build();
            persistSandbox(redisKey, info);
            return endpoints;
        } finally {
            releaseCreationLock(lockKey, lockToken);
        }
    }

    @Override
    public SandboxResponse<Void> removeSandbox(SandboxLaunchRequest request) {
        try {
            String userCode = request.getUserCode();
            String sandboxType = request.getSandboxType();
            String redisKey = buildRedisKey(userCode, sandboxType);
            SandboxInfo info = readCachedInfo(redisKey);
            runtimeProvider.remove(userCode, sandboxType, info);
            redisTemplate.delete(redisKey);
            redisTemplate.delete(buildCreationLockKey(userCode, sandboxType));
            redisTemplate.opsForZSet().remove(REDIS_EXPIRE_INDEX_KEY, buildExpireIndexMember(userCode, sandboxType));
            redisTemplate.opsForSet().remove(buildUserIndexKey(userCode), sandboxType);
            return SandboxResponse.success(null);
        } catch (Exception e) {
            log.error("Failed to remove sandbox by provider={}, user={}, type={}: {}",
                runtimeProvider.providerType(), request.getUserCode(), request.getSandboxType(), e.getMessage(), e);
            return SandboxResponse.error(e.getMessage());
        }
    }

    @Override
    public SandboxResponse<Void> heartbeat(String userCode) {
        try {
            String userIndexKey = buildUserIndexKey(userCode);
            Set<String> sandboxTypes = redisTemplate.opsForSet().members(userIndexKey);
            if (sandboxTypes == null || sandboxTypes.isEmpty()) {
                runtimeProvider.heartbeat(userCode, null, null);
                return SandboxResponse.success(null);
            }

            long ttlSeconds = properties.getHeartbeatTimeout().multipliedBy(SANDBOX_INFO_TTL_MULTIPLIER).toSeconds();
            for (String sandboxType : sandboxTypes) {
                String redisKey = buildRedisKey(userCode, sandboxType);
                SandboxInfo info = readCachedInfo(redisKey);
                if (info == null) {
                    redisTemplate.opsForSet().remove(userIndexKey, sandboxType);
                    redisTemplate.opsForZSet().remove(REDIS_EXPIRE_INDEX_KEY, buildExpireIndexMember(userCode, sandboxType));
                    continue;
                }
                runtimeProvider.heartbeat(userCode, sandboxType, info);
                info.setLastHeartbeatTime(LocalDateTime.now());
                redisTemplate.opsForValue().set(redisKey, serialize(info), ttlSeconds, TimeUnit.SECONDS);
                touchExpireIndex(userCode, sandboxType);
                touchUserIndex(userCode, sandboxType);
            }
            return SandboxResponse.success(null);
        } catch (Exception e) {
            log.error("Failed to heartbeat by provider={}, user={}: {}", runtimeProvider.providerType(), userCode, e.getMessage(), e);
            return SandboxResponse.error(e.getMessage());
        }
    }

    @Override
    public SandboxResponse<List<SandboxInfo>> sandboxInfo(String userCode) {
        try {
            Set<String> sandboxTypes = redisTemplate.opsForSet().members(buildUserIndexKey(userCode));
            List<SandboxInfo> result = new ArrayList<>();
            if (sandboxTypes != null) {
                for (String sandboxType : sandboxTypes) {
                    SandboxInfo info = readCachedInfo(buildRedisKey(userCode, sandboxType));
                    if (info != null) {
                        result.add(info);
                    }
                }
            }
            return SandboxResponse.success(result);
        } catch (Exception e) {
            return SandboxResponse.error(e.getMessage());
        }
    }

    @Override
    public SandboxResponse<SandboxInfo> sandboxInfo(String userCode, String sandboxType) {
        try {
            return SandboxResponse.success(readCachedInfo(buildRedisKey(userCode, sandboxType)));
        } catch (Exception e) {
            return SandboxResponse.error(e.getMessage());
        }
    }

    @Scheduled(fixedDelayString = "${byclaw.sandbox.cleanup-interval:${byai.worker-manager.cleanup-interval:PT5M}}")
    public void cleanupExpiredSandboxes() {
        if (properties.isPermanentKeep()) {
            return;
        }
        try {
            double nowEpoch = Instant.now().getEpochSecond();
            Set<String> expiredMembers = redisTemplate.opsForZSet()
                .rangeByScore(REDIS_EXPIRE_INDEX_KEY, Double.NEGATIVE_INFINITY, nowEpoch);
            if (expiredMembers == null || expiredMembers.isEmpty()) {
                return;
            }
            for (String member : expiredMembers) {
                String[] parsed = parseExpireIndexMember(member);
                if (parsed == null) {
                    redisTemplate.opsForZSet().remove(REDIS_EXPIRE_INDEX_KEY, member);
                    continue;
                }
                String userCode = parsed[0];
                String sandboxType = parsed[1];
                SandboxInfo info = readCachedInfo(buildRedisKey(userCode, sandboxType));
                if (info == null || isExpired(info)) {
                    runtimeProvider.remove(userCode, sandboxType, info);
                    redisTemplate.delete(buildRedisKey(userCode, sandboxType));
                    redisTemplate.opsForZSet().remove(REDIS_EXPIRE_INDEX_KEY, member);
                    redisTemplate.opsForSet().remove(buildUserIndexKey(userCode), sandboxType);
                } else {
                    touchExpireIndex(userCode, sandboxType);
                }
            }
        } catch (Exception e) {
            log.warn("cleanupExpiredSandboxes skipped for provider={}: {}", runtimeProvider.providerType(), e.getMessage());
        }
    }

    private boolean isExpired(SandboxInfo info) {
        return info.getLastHeartbeatTime() == null
            || Duration.between(info.getLastHeartbeatTime(), LocalDateTime.now()).compareTo(properties.getHeartbeatTimeout()) > 0;
    }

    private void persistSandbox(String redisKey, SandboxInfo info) {
        long ttlSeconds = properties.getHeartbeatTimeout().multipliedBy(SANDBOX_INFO_TTL_MULTIPLIER).toSeconds();
        redisTemplate.opsForValue().set(redisKey, serialize(info), ttlSeconds, TimeUnit.SECONDS);
        touchExpireIndex(info.getUserCode(), info.getSandboxType());
        touchUserIndex(info.getUserCode(), info.getSandboxType());
    }

    private List<String> readCachedEndpoints(String redisKey, String userCode, String sandboxType) {
        SandboxInfo existing = readCachedInfo(redisKey);
        if (existing == null) {
            return null;
        }
        log.info("Found existing sandbox for user={}, type={}, provider={}, sandboxId={}",
            userCode, sandboxType, runtimeProvider.providerType(), existing.getSandboxId());
        return existing.getEndpoints();
    }

    private SandboxInfo readCachedInfo(String redisKey) {
        String json = redisTemplate.opsForValue().get(redisKey);
        if (json == null || json.isBlank()) {
            return null;
        }
        SandboxInfo info = deserialize(json);
        if (info == null) {
            redisTemplate.delete(redisKey);
        }
        return info;
    }

    private String buildRedisKey(String userCode, String sandboxType) {
        return REDIS_KEY_PREFIX + userCode + ":" + sandboxType;
    }

    private String buildCreationLockKey(String userCode, String sandboxType) {
        return buildRedisKey(userCode, sandboxType) + REDIS_CREATE_LOCK_SUFFIX;
    }

    private void releaseCreationLock(String lockKey, String lockToken) {
        String current = redisTemplate.opsForValue().get(lockKey);
        if (lockToken.equals(current)) {
            redisTemplate.delete(lockKey);
        }
    }

    private void touchExpireIndex(String userCode, String sandboxType) {
        long expiresAt = Instant.now().plus(properties.getHeartbeatTimeout()).getEpochSecond();
        redisTemplate.opsForZSet().add(REDIS_EXPIRE_INDEX_KEY, buildExpireIndexMember(userCode, sandboxType), expiresAt);
    }

    private void touchUserIndex(String userCode, String sandboxType) {
        redisTemplate.opsForSet().add(buildUserIndexKey(userCode), sandboxType);
    }

    private String buildUserIndexKey(String userCode) {
        return REDIS_USER_INDEX_PREFIX + userCode;
    }

    private String buildExpireIndexMember(String userCode, String sandboxType) {
        return userCode + "\0" + sandboxType;
    }

    private String[] parseExpireIndexMember(String member) {
        if (member == null) {
            return null;
        }
        int separator = member.indexOf('\0');
        if (separator < 0) {
            return null;
        }
        return new String[] {member.substring(0, separator), member.substring(separator + 1)};
    }

    private Integer resolveTimeoutSeconds(Integer specTimeout, Integer autoRelease) {
        if (autoRelease == null) {
            return normalizeTimeoutSeconds(specTimeout);
        }
        if (autoRelease <= 0) {
            return null;
        }
        if (autoRelease == 1) {
            return Math.toIntExact(properties.getHeartbeatTimeout().toSeconds());
        }
        return autoRelease;
    }

    private Integer normalizeTimeoutSeconds(Integer timeout) {
        return timeout != null && timeout > 0 ? timeout : null;
    }

    private String serialize(SandboxInfo info) {
        try {
            return objectMapper.writeValueAsString(info);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize SandboxInfo", e);
        }
    }

    private SandboxInfo deserialize(String json) {
        try {
            return objectMapper.readValue(json, SandboxInfo.class);
        } catch (Exception e) {
            log.warn("Failed to deserialize SandboxInfo: {}", e.getMessage());
            return null;
        }
    }

    private static String buildIdempotencyKey(String userCode, String sandboxType) {
        String raw = Objects.toString(userCode, "") + "\0" + Objects.toString(sandboxType, "");
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            String hex = sb.toString();
            return hex.length() > K8S_LABEL_VALUE_MAX_LEN ? hex.substring(0, K8S_LABEL_VALUE_MAX_LEN) : hex;
        } catch (Exception e) {
            throw new IllegalStateException("Failed to build idempotency key", e);
        }
    }
}
