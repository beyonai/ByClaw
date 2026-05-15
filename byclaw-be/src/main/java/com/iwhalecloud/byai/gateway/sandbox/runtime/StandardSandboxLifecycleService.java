package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.apache.commons.collections4.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

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
    private static final String REDIS_USER_INDEX_PREFIX = "byai:worker:sandbox:user-index:";
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
            log.info("生命周期服务开始启动沙箱，provider={}，user={}，type={}",
                runtimeProvider.providerType(), request.getUserCode(), request.getSandboxType());
            SandboxInfo info = createSandbox(request);
            SandboxLaunchData data = new SandboxLaunchData();
            List<String> endpoints = info.getEndpoints();
            data.setEndpoint(CollectionUtils.isNotEmpty(endpoints) ? endpoints.getFirst() : "");
            data.setEndpoints(endpoints);
            data.setEndpointHeaders(info.getEndpointHeaders());
            data.setSandboxId(info.getSandboxId());
            data.setTimeoutSeconds(info.getTimeoutSeconds());
            data.setRemoteExpiresAt(info.getRemoteExpiresAt());
            log.info("生命周期服务启动沙箱成功，provider={}，user={}，type={}，sandboxId={}，endpoints={}，remoteExpiresAt={}",
                runtimeProvider.providerType(), request.getUserCode(), request.getSandboxType(),
                info.getSandboxId(), endpoints, info.getRemoteExpiresAt());
            return SandboxResponse.success(data);
        } catch (Exception e) {
            log.error("Failed to launch sandbox by provider={}, user={}, type={}: {}",
                runtimeProvider.providerType(), request.getUserCode(), request.getSandboxType(), e.getMessage(), e);
            return SandboxResponse.error(e.getMessage());
        }
    }

    private SandboxInfo createSandbox(SandboxLaunchRequest launchRequest) {
        String userCode = launchRequest.getUserCode();
        String sandboxType = launchRequest.getSandboxType();
        String redisKey = buildRedisKey(userCode, sandboxType);

        SandboxServiceSpec spec = specRepository.findByServiceKey(sandboxType).orElse(null);
        if (spec == null) {
            throw new IllegalArgumentException("Unknown sandbox service key: " + sandboxType);
        }

        String lockKey = buildCreationLockKey(userCode, sandboxType);
        String lockToken = UUID.randomUUID().toString();
        Boolean gotLock = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, lockToken, Objects.requireNonNull(properties.getSandboxCreationLockTtl()));
        if (!Boolean.TRUE.equals(gotLock)) {
            throw new IllegalStateException("沙箱正在创建中，请稍后重试: user=" + userCode + ", type=" + sandboxType);
        }

        try {
            log.info("生命周期服务已获取创建锁，provider={}，user={}，type={}，lockKey={}",
                runtimeProvider.providerType(), userCode, sandboxType, lockKey);
            var request = specProcessor.buildCreateRequest(
                userCode, sandboxType, launchRequest.getEnvs(), launchRequest.getUserInfo(), spec);
            String idempotencyKey = buildIdempotencyKey(userCode, sandboxType);

            Optional<SandboxRuntimeInstance> reusable = runtimeProvider.findReusable(userCode, sandboxType);
            if (reusable.isPresent()) {
                log.info("生命周期服务命中可复用远端沙箱，provider={}，user={}，type={}，sandboxId={}",
                    runtimeProvider.providerType(), userCode, sandboxType, reusable.get().getSandboxId());
            }
            else {
                log.info("生命周期服务未命中可复用沙箱，准备创建新沙箱，provider={}，user={}，type={}，idempotencyKey={}",
                    runtimeProvider.providerType(), userCode, sandboxType, idempotencyKey);
            }
            SandboxRuntimeInstance instance = reusable
                .orElseGet(() -> runtimeProvider.create(request, spec, userCode, sandboxType, idempotencyKey));

            List<String> endpoints = runtimeProvider.resolveEndpoints(instance, spec, request);
            Integer timeoutSeconds = resolveTimeoutSeconds(instance, request.getTimeout());
            SandboxInfo info = SandboxInfo.builder()
                .sandboxId(instance.getSandboxId())
                .userCode(userCode)
                .sandboxType(sandboxType)
                .endpoints(endpoints)
                .endpointHeaders(runtimeProvider.resolveEndpointHeaders(instance))
                .timeoutSeconds(timeoutSeconds)
                .remoteExpiresAt(resolveRemoteExpiresAt(instance, timeoutSeconds))
                .createdTime(resolveCreatedTime(instance))
                .lastHeartbeatTime(LocalDateTime.now())
                .build();
            persistSandbox(redisKey, info);
            log.info("生命周期服务已写入 redis 元数据，provider={}，user={}，type={}，sandboxId={}，redisKey={}",
                runtimeProvider.providerType(), userCode, sandboxType, info.getSandboxId(), redisKey);
            return info;
        } finally {
            releaseCreationLock(lockKey, lockToken);
        }
    }

    @Override
    public SandboxResponse<Void> removeSandbox(SandboxInfo sandboxInfo) {
        try {
            if (sandboxInfo == null) {
                return SandboxResponse.success(null);
            }
            log.info("生命周期服务开始释放沙箱，provider={}，user={}，type={}，sandboxId={}",
                runtimeProvider.providerType(), sandboxInfo.getUserCode(), sandboxInfo.getSandboxType(),
                sandboxInfo.getSandboxId());
            runtimeProvider.remove(sandboxInfo.getUserCode(), sandboxInfo.getSandboxType(), sandboxInfo);
            redisTemplate.delete(buildRedisKey(sandboxInfo.getUserCode(), sandboxInfo.getSandboxType()));
            redisTemplate.delete(buildCreationLockKey(sandboxInfo.getUserCode(), sandboxInfo.getSandboxType()));
            redisTemplate.opsForSet().remove(buildUserIndexKey(sandboxInfo.getUserCode()), sandboxInfo.getSandboxType());
            log.info("生命周期服务释放沙箱完成，provider={}，user={}，type={}，sandboxId={}",
                runtimeProvider.providerType(), sandboxInfo.getUserCode(), sandboxInfo.getSandboxType(),
                sandboxInfo.getSandboxId());
            return SandboxResponse.success(null);
        } catch (Exception e) {
            log.error("Failed to remove sandbox by provider={}, user={}, type={}: {}",
                runtimeProvider.providerType(),
                sandboxInfo != null ? sandboxInfo.getUserCode() : null,
                sandboxInfo != null ? sandboxInfo.getSandboxType() : null,
                e.getMessage(), e);
            return SandboxResponse.error(e.getMessage());
        }
    }

    @Override
    public SandboxResponse<Void> renewSandbox(SandboxInfo sandboxInfo) {
        try {
            if (sandboxInfo == null) {
                return SandboxResponse.error("sandboxInfo is required");
            }
            log.info("生命周期服务开始续约沙箱，provider={}，user={}，type={}，sandboxId={}，timeoutSeconds={}，remoteExpiresAt={}",
                runtimeProvider.providerType(), sandboxInfo.getUserCode(), sandboxInfo.getSandboxType(),
                sandboxInfo.getSandboxId(), sandboxInfo.getTimeoutSeconds(), sandboxInfo.getRemoteExpiresAt());
            runtimeProvider.heartbeat(sandboxInfo.getUserCode(), sandboxInfo.getSandboxType(), sandboxInfo);
            sandboxInfo.setLastHeartbeatTime(LocalDateTime.now());
            persistSandbox(buildRedisKey(sandboxInfo.getUserCode(), sandboxInfo.getSandboxType()), sandboxInfo);
            log.info("生命周期服务续约沙箱完成，provider={}，user={}，type={}，sandboxId={}",
                runtimeProvider.providerType(), sandboxInfo.getUserCode(), sandboxInfo.getSandboxType(),
                sandboxInfo.getSandboxId());
            return SandboxResponse.success(null);
        }
        catch (Exception e) {
            log.error("Failed to renew sandbox by provider={}, user={}, type={}, sandboxId={}: {}",
                runtimeProvider.providerType(), sandboxInfo != null ? sandboxInfo.getUserCode() : null,
                sandboxInfo != null ? sandboxInfo.getSandboxType() : null,
                sandboxInfo != null ? sandboxInfo.getSandboxId() : null,
                e.getMessage(), e);
            return SandboxResponse.error(e.getMessage());
        }
    }

    @Override
    public SandboxResponse<Boolean> sandboxExists(SandboxInfo sandboxInfo) {
        try {
            if (sandboxInfo == null) {
                return SandboxResponse.success(false);
            }
            boolean exists = runtimeProvider.exists(
                sandboxInfo.getUserCode(), sandboxInfo.getSandboxType(), sandboxInfo);
            log.info("生命周期服务查询远端沙箱存在性，provider={}，user={}，type={}，sandboxId={}，exists={}",
                runtimeProvider.providerType(), sandboxInfo.getUserCode(), sandboxInfo.getSandboxType(),
                sandboxInfo.getSandboxId(), exists);
            return SandboxResponse.success(exists);
        }
        catch (Exception e) {
            log.warn("Failed to reconcile sandbox by provider={}, user={}, type={}, sandboxId={}: {}",
                runtimeProvider.providerType(), sandboxInfo != null ? sandboxInfo.getUserCode() : null,
                sandboxInfo != null ? sandboxInfo.getSandboxType() : null,
                sandboxInfo != null ? sandboxInfo.getSandboxId() : null,
                e.getMessage(), e);
            return SandboxResponse.error(e.getMessage());
        }
    }

    private void persistSandbox(String redisKey, SandboxInfo info) {
        long ttlSeconds = Math.max(60L, properties.getMetadataCacheTtl().toSeconds());
        redisTemplate.opsForValue().set(redisKey, serialize(info), ttlSeconds, TimeUnit.SECONDS);
        touchUserIndex(info.getUserCode(), info.getSandboxType());
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

    private void touchUserIndex(String userCode, String sandboxType) {
        redisTemplate.opsForSet().add(buildUserIndexKey(userCode), sandboxType);
    }

    private String buildUserIndexKey(String userCode) {
        return REDIS_USER_INDEX_PREFIX + userCode;
    }

    private Integer resolveTimeoutSeconds(SandboxRuntimeInstance instance, Integer specTimeout) {
        if (instance != null && instance.getCreatedAt() != null && instance.getExpiresAt() != null) {
            long seconds = ChronoUnit.SECONDS.between(instance.getCreatedAt(), instance.getExpiresAt());
            if (seconds > 0) {
                return Math.toIntExact(seconds);
            }
        }
        return specTimeout != null && specTimeout > 0 ? specTimeout : null;
    }

    private Date resolveRemoteExpiresAt(SandboxRuntimeInstance instance, Integer timeoutSeconds) {
        if (instance != null && instance.getExpiresAt() != null) {
            return Date.from(instance.getExpiresAt().toInstant());
        }
        if (timeoutSeconds == null || timeoutSeconds <= 0) {
            return null;
        }
        return Date.from(Instant.now().plusSeconds(timeoutSeconds));
    }

    private LocalDateTime resolveCreatedTime(SandboxRuntimeInstance instance) {
        OffsetDateTime createdAt = instance != null ? instance.getCreatedAt() : null;
        if (createdAt == null) {
            return LocalDateTime.now();
        }
        return LocalDateTime.ofInstant(createdAt.toInstant(), ZoneId.systemDefault());
    }

    private String serialize(SandboxInfo info) {
        try {
            return objectMapper.writeValueAsString(info);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize SandboxInfo", e);
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
