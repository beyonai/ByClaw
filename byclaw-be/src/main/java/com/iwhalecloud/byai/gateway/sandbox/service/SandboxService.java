package com.iwhalecloud.byai.gateway.sandbox.service;

import java.time.Duration;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import com.iwhaleai.byai.framework.common.Constants;
import com.iwhaleai.byai.framework.common.RedisClient;
import com.iwhaleai.byai.framework.core.WorkerRegistry;
import com.iwhaleai.byai.framework.core.discovery.ServiceRegistry;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest;
import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxLeasePolicy;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimePage;
import com.iwhalecloud.byai.gateway.sandbox.support.SandboxEndpointRecordSupport;
import com.iwhalecloud.byai.manager.entity.sandbox.SandboxReconcileGroup;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import io.github.resilience4j.retry.Retry;
import io.github.resilience4j.retry.RetryConfig;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import redis.clients.jedis.Jedis;

/**
 * 沙箱服务 提供沙箱环境的启动、释放、查询和自动清理等功能
 */
@Service
public class SandboxService {

    private static final String GATEWAY_TOKEN_METADATA_KEY = "gateway_token";

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxService.class);

    /** 沙箱状态：运行中 */
    private static final String STATUS_RUNNING = "RUNNING";

    /** 沙箱状态：启动中 */
    private static final String STATUS_STARTING = "STARTING";

    /** 沙箱状态：释放中 */
    private static final String STATUS_RELEASING = "RELEASING";

    /** 沙箱状态：已释放 */
    private static final String STATUS_RELEASED = "RELEASED";

    /** 手动释放终止原因。 */
    private static final String RELEASE_REASON_MANUAL = "release.manual";

    /** 自动空闲超时释放终止原因。 */
    private static final String RELEASE_REASON_AUTO_IDLE_TIMEOUT = "release.auto.idle-timeout";

    /** 远端沙箱退出后终止旧记录的原因。 */
    private static final String RELEASE_REASON_REMOTE_EXIT = "release.remote.exit";

    /** reconcile 发现远端不存在或不可复用时终止旧记录的原因。 */
    private static final String RELEASE_REASON_REMOTE_MISSING = "release.remote.missing";

    /** 集成类型：沙箱 */
    private static final String INTEGRATION_TYPE_SANDBOX = "FROM_SANDBOX";

    /** 来源系统：沙箱 */
    private static final String SYS_CODE = "SANDBOX";

    /** 自动释放：超出闲置时间后由 cleanup 释放。 */
    private static final Integer AUTO_RELEASE_REMOTE = 1;

    /** 手动释放：持续续约，只能由用户或管理员显式释放。 */
    private static final Integer AUTO_RELEASE_MANUAL = 0;

    @Lazy
    @Autowired
    private SandboxLifecycleFacade sandboxLifecycleFacade;

    @Lazy
    @Autowired
    private SsSandboxRecordMapper sandboxRecordMapper;

    @Lazy
    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Lazy
    @Autowired
    private SandboxLaunchContextFactory sandboxLaunchContextFactory;

    @Lazy
    @Autowired
    private SandboxMetadataCache sandboxMetadataCache;

    @Lazy
    @Autowired
    private SandboxUserContextRunner sandboxUserContextRunner;

    @Lazy
    @Autowired
    private RedisClient redisClient;

    /** 系统参数：允许同时使用的沙箱数量上限，paramCode=ENABLE_USE_SANDBOX_NUM */
    private static final String PARAM_ENABLE_USE_SANDBOX_NUM = "ENABLE_USE_SANDBOX_NUM";

    /** 沙箱启动分布式锁key前缀，保证同一用户同一资源只有一个沙箱 */
    private static final String SANDBOX_LAUNCH_LOCK_PREFIX = "sandbox:launch:lock:";

    /** 沙箱启动分布式锁过期时间（秒），避免锁持有者异常时死锁 */
    private static final long SANDBOX_LAUNCH_LOCK_EXPIRE_SECONDS = 120L;

    /** 等待沙箱就绪的默认超时时间（毫秒） */
    private static final long SANDBOX_AWAIT_TIMEOUT_MS = 120_000L;

    /** 等待沙箱就绪时的轮询间隔（毫秒） */
    private static final long SANDBOX_AWAIT_POLL_INTERVAL_MS = 2_000L;

    /** 等待 Gateway worker 注册完成的超时时间（毫秒） */
    public static final long WORKER_READY_TIMEOUT_MS = TimeUnit.MINUTES.toMillis(1);

    /** 等待 Gateway worker 注册完成的轮询间隔（毫秒） */
    private static final long WORKER_READY_POLL_INTERVAL_MS = 100L;

    /** Lifecycle jobs scan all candidates in fixed internal pages. */
    private static final int LIFECYCLE_SCAN_PAGE_SIZE = 100;

    private static final String SANDBOX_RECONCILE_JOB_LOCK_KEY = "sandbox:job:reconcile:lock";

    /** Redis key 前缀：用户首选沙箱 serviceKey */
    private static final String PREFERRED_SERVICE_KEY_PREFIX = "byai:sandbox:preferred-service-key:";

    /** 沙箱空闲超时时间（分钟） */
    @Value("${sandbox.idle.timeout.minutes:30}")
    private int idleTimeoutMinutes;

    @Value("${byclaw.sandbox.default-lease-policy:REMOTE_AUTO_EXPIRE}")
    private String defaultLeasePolicy;

    @Value("${byclaw.sandbox.renew-ahead-seconds:120}")
    private long renewAheadSeconds;

    @Value("${sandbox.reconcile.group-limit:50}")
    private int reconcileGroupLimit;

    @Value("${sandbox.reconcile.record-limit-per-group:500}")
    private int reconcileRecordLimitPerGroup;

    @Value("${sandbox.reconcile.remote-page-size:200}")
    private int reconcileRemotePageSize;

    @Value("${sandbox.reconcile.max-records-per-run:3000}")
    private int reconcileMaxRecordsPerRun;

    @Value("${sandbox.reconcile.max-duration-ms:30000}")
    private long reconcileMaxDurationMs;

    @Value("${sandbox.reconcile.remote-concurrency:3}")
    private int reconcileRemoteConcurrency;

    @Value("${sandbox.reconcile.lock.enabled:true}")
    private boolean reconcileJobLockEnabled;

    @Lazy
    @Autowired
    private WorkerRegistry gatewayWorkerRegistry;

    /**
     * 启动沙箱并记录 通过resourceId查询数字员工扩展信息，获取agentDevType作为沙箱类型， 并从prologue中提取modelId查询模型信息构建沙箱环境变量
     *
     * @param userCode 用户编码
     * @param resourceId 资源ID
     * @return 沙箱启动响应数据
     */
    public SandboxLaunchData launchSandbox(String userCode, Long resourceId) {
        return launchSandboxInternal(userCode, resourceId, sandboxLaunchContextFactory.resolveRouting(resourceId, userCode));
    }

    /**
     * 按工号启动沙箱，支持通过 serviceKey 覆盖沙箱类型。
     * 如果 serviceKey 为空则走默认 resolveRouting 逻辑（其中会查询用户首选 serviceKey）。
     *
     * @param userCode   用户工号
     * @param serviceKey sandbox_service_spec 表的 service_key，可选
     * @return 沙箱启动响应数据
     */
    public SandboxLaunchData launchSandboxWithServiceKey(String userCode, String serviceKey) {
        if (StringUtils.isBlank(serviceKey)) {
            return launchSandbox(userCode, null);
        }
        SandboxLaunchRouting routing = new SandboxLaunchRouting(serviceKey,
            SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        return launchSandboxInternal(userCode, null, routing);
    }

    /**
     * 统一的“确保沙箱可用”入口。
     * 登录预启动和会话重试都应通过这里进入，避免在调用侧各自拼接等待逻辑。
     */
    public SandboxLaunchData ensureSandboxReady(String userCode, Long resourceId, String targetAgentType) {
        LOGGER.info("确保沙箱可用，用户编码：{}，资源ID：{}，targetAgentType：{}", userCode, resourceId, targetAgentType);
        if (StringUtils.isBlank(targetAgentType)) {
            return launchSandbox(userCode, resourceId);
        }
        SandboxLaunchData launchData = launchSandboxAwait(userCode, resourceId);
        waitWorkerReadySync(targetAgentType);
        return launchData;
    }

    /**
     * 保存用户首选 serviceKey 到 Redis
     *
     * @param userCode   用户工号
     * @param serviceKey 沙箱规格 serviceKey
     */
    public void savePreferredServiceKey(String userCode, String serviceKey) {
        if (StringUtils.isBlank(userCode) || StringUtils.isBlank(serviceKey)) {
            return;
        }
        String key = PREFERRED_SERVICE_KEY_PREFIX + userCode;
        RedisUtil.setString(key, serviceKey);
        LOGGER.info("保存用户首选 serviceKey: userCode={}, serviceKey={}", userCode, serviceKey);
    }

    /**
     * 获取用户首选 serviceKey
     *
     * @param userCode 用户工号
     * @return serviceKey，不存在则返回 null
     */
    public String getPreferredServiceKey(String userCode) {
        if (StringUtils.isBlank(userCode)) {
            return null;
        }
        return RedisUtil.getString(PREFERRED_SERVICE_KEY_PREFIX + userCode);
    }

    /**
     * 清除用户首选 serviceKey
     *
     * @param userCode 用户工号
     */
    public void removePreferredServiceKey(String userCode) {
        if (StringUtils.isBlank(userCode)) {
            return;
        }
        RedisUtil.removeKey(PREFERRED_SERVICE_KEY_PREFIX + userCode);
        LOGGER.info("清除用户首选 serviceKey: userCode={}", userCode);
    }

    /**
     * 远端沙箱退出后的重拉流程。
     * <p>调用方已确认当前 worker 不可用时使用：先终结旧活跃记录，释放 DB 唯一键，再重新走标准启动流程。</p>
     */
    public SandboxLaunchData restartSandboxAfterRemoteExit(String userCode, Long resourceId, String targetAgentType) {
        return restartSandboxAfterRemoteExit(userCode, resourceId, targetAgentType, true);
    }

    /**
     * 远端沙箱退出后的重拉流程，但不等待 worker 就绪。
     * 由调用方自行控制等待节奏时使用，避免长时间阻塞在单次等待里。
     */
    public SandboxLaunchData restartSandboxAfterRemoteExitWithoutWait(String userCode, Long resourceId,
        String targetAgentType) {
        return restartSandboxAfterRemoteExit(userCode, resourceId, targetAgentType, false);
    }

    private SandboxLaunchData restartSandboxAfterRemoteExit(String userCode, Long resourceId, String targetAgentType,
        boolean waitForWorkerReady) {
        SandboxLaunchRouting routing = sandboxLaunchContextFactory.resolveRouting(resourceId, userCode);
        String lockKey = buildLaunchLockKey(userCode, routing);
        String lockValue = UUID.randomUUID().toString();
        boolean locked = false;

        LOGGER.info("开始重拉远端已退出沙箱，用户编码：{}，资源ID：{}，沙箱类型：{}，effectiveResourceId：{}，targetAgentType：{}",
            userCode, resourceId, routing.getSandboxType(), routing.getEffectiveResourceId(), targetAgentType);

        try {
            locked = RedisUtil.lock(lockKey, lockValue, SANDBOX_LAUNCH_LOCK_EXPIRE_SECONDS);
            if (!locked) {
                LOGGER.warn("获取沙箱重拉锁失败，用户编码：{}，沙箱类型：{}，资源ID：{}，可能并发创建中",
                    userCode, routing.getSandboxType(), routing.getEffectiveResourceId());
                throw new BdpRuntimeException(I18nUtil.get("sandbox.launch.busy"));
            }

            SsSandboxRecord existingRecord = sandboxRecordMapper.selectActiveByUserAndResource(userCode,
                routing.getSandboxType(), routing.getEffectiveResourceId());
            if (existingRecord != null) {
                LOGGER.info("重拉前命中旧活跃记录：{}", sandboxRef(existingRecord));
                int marked = sandboxRecordMapper.markReleased(existingRecord.getId(),
                    RELEASE_REASON_REMOTE_EXIT, new Date(), existingRecord.getLockVersion());
                if (marked > 0) {
                    incrementVersions(existingRecord, true);
                    sandboxMetadataCache.evict(existingRecord.getUserCode(), existingRecord.getSandboxType());
                    LOGGER.warn("远端沙箱退出，已终结旧沙箱记录：{}", sandboxRef(existingRecord));
                }
            }

            SandboxLaunchData launchData = doLaunchSandbox(userCode, resourceId, routing);
            if (waitForWorkerReady && launchData != null && StringUtils.isNotBlank(targetAgentType)) {
                waitWorkerReadySync(targetAgentType);
            }
            LOGGER.info("重拉远端已退出沙箱完成，用户编码：{}，资源ID：{}，新sandboxId：{}，endpoint：{}",
                userCode, resourceId, launchData != null ? launchData.getSandboxId() : null,
                launchData != null ? launchData.getEndpoint() : null);
            return launchData;
        }
        finally {
            if (locked) {
                RedisUtil.releaseLock(lockKey, lockValue);
            }
        }
    }

    /**
     * 启动沙箱（内部实现），支持沙箱类型覆盖。
     *
     * @param userCode            用户编码
     * @param resourceId          资源ID
     * @param sandboxTypeOverride 沙箱类型覆盖值，null 表示由 agentDevType 决定
     * @return 沙箱启动响应数据
     */
    private SandboxLaunchData launchSandboxInternal(String userCode, Long resourceId, SandboxLaunchRouting routing) {
        String lockKey = buildLaunchLockKey(userCode, routing);
        String lockValue = UUID.randomUUID().toString();
        boolean locked = false;

        LOGGER.info("进入沙箱启动主流程，用户编码：{}，resourceId：{}，沙箱类型：{}，effectiveResourceId：{}",
            userCode, resourceId, routing.getSandboxType(), routing.getEffectiveResourceId());
        try {
            locked = RedisUtil.lock(lockKey, lockValue, SANDBOX_LAUNCH_LOCK_EXPIRE_SECONDS);
            if (!locked) {
                LOGGER.warn("获取沙箱启动锁失败，用户编码：{}，资源ID：{}，可能并发创建中", userCode, resourceId);
                throw new BdpRuntimeException(I18nUtil.get("sandbox.launch.busy"));
            }

            // 双重检查：在锁内再次查询，防止并发请求重复创建沙箱
            SsSandboxRecord existingRecord = sandboxRecordMapper.selectActiveByUserAndResource(userCode,
                routing.getSandboxType(), routing.getEffectiveResourceId());
            if (existingRecord != null && STATUS_RUNNING.equals(existingRecord.getStatus())
                && StringUtils.isNotBlank(existingRecord.getEndpoint())) {
                LOGGER.info("复用已有沙箱：{}", sandboxRef(existingRecord));
                sandboxMetadataCache.put(toSandboxInfo(existingRecord));
                return buildLaunchData(existingRecord);
            }
            if (existingRecord != null) {
                LOGGER.warn("沙箱处于非可复用状态：{}", sandboxRef(existingRecord));
                throw new BdpRuntimeException(I18nUtil.get("sandbox.launch.busy"));
            }

            return doLaunchSandbox(userCode, resourceId, routing);
        }
        finally {
            if (locked) {
                RedisUtil.releaseLock(lockKey, lockValue);
            }
        }
    }

    private String buildLaunchLockKey(String userCode, SandboxLaunchRouting routing) {
        return SANDBOX_LAUNCH_LOCK_PREFIX + userCode + ":" + routing.getSandboxType() + ":"
            + routing.getEffectiveResourceId();
    }

    /**
     * 启动沙箱并等待就绪。 先查询DB是否已有记录，有则直接轮询endpoint是否就绪； 没有记录则先调用launchSandbox启动，再轮询endpoint是否就绪。
     *
     * @param userCode 用户编码
     * @param resourceId 资源ID，允许为null
     * @return 沙箱启动响应数据
     */
    public SandboxLaunchData launchSandboxAwait(String userCode, Long resourceId) {
        SandboxLaunchRouting routing = sandboxLaunchContextFactory.resolveRouting(resourceId, userCode);

        // 1. 查询DB是否已有运行中的沙箱记录
        SsSandboxRecord existingRecord = sandboxRecordMapper.selectRunningByUserAndResource(userCode,
            routing.getSandboxType(), routing.getEffectiveResourceId());
        String endpoint;

        if (existingRecord != null && StringUtils.isNotBlank(existingRecord.getEndpoint())) {
            // 已有记录，直接拿到endpoint
            endpoint = normalizeRecordEndpoint(existingRecord);
            LOGGER.info("等待模式-发现已有沙箱记录：{}", sandboxRef(existingRecord));
        }
        else {
            // 2. 没有记录，先调用launchSandbox启动
            LOGGER.info("等待模式-未找到沙箱记录，先启动沙箱，用户编码：{}，资源ID：{}", userCode, resourceId);
            SandboxLaunchData launchData = launchSandboxInternal(userCode, resourceId, routing);
            if (routing.isByclawCodeAgent()) {
                return launchData;
            }
            if (launchData == null || StringUtils.isBlank(launchData.getEndpoint())) {
                LOGGER.error("等待模式-启动沙箱失败，返回为空，用户编码：{}", userCode);
                return launchData;
            }
            endpoint = launchData.getEndpoint();
        }

        // 3. 轮询endpoint，等待沙箱服务真正就绪
        if (waitForEndpointReady(endpoint, userCode, resourceId)) {
            SandboxLaunchData result = new SandboxLaunchData();
            result.setEndpoint(endpoint);
            return result;
        }

        // 超时仍未就绪，返回endpoint，让调用方自行处理
        LOGGER.warn("等待模式-沙箱endpoint就绪超时，用户编码：{}，endpoint：{}", userCode, endpoint);
        SandboxLaunchData result = new SandboxLaunchData();
        result.setEndpoint(endpoint);
        return result;
    }

    /**
     * 轮询检测沙箱endpoint是否已就绪（能够成功响应HTTP请求） 使用 resilience4j-retry 替代手写 while+sleep，重试策略集中声明
     *
     * @param endpoint 沙箱endpoint地址
     * @param userCode 用户编码（仅用于日志）
     * @param resourceId 资源ID（仅用于日志）
     * @return true-就绪，false-超时未就绪
     */
    private boolean waitForEndpointReady(String endpoint, String userCode, Long resourceId) {
        int maxAttempts = (int) (SANDBOX_AWAIT_TIMEOUT_MS / SANDBOX_AWAIT_POLL_INTERVAL_MS);
        RetryConfig config = RetryConfig.custom().maxAttempts(maxAttempts)
            .waitDuration(Duration.ofMillis(SANDBOX_AWAIT_POLL_INTERVAL_MS)).retryOnResult(Boolean.FALSE::equals)
            .retryOnException(e -> true).build();
        Retry retry = Retry.of("sandbox-probe-" + userCode, config);

        OkHttpClient httpClient = new OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS).build();

        try {
            return Retry.decorateCheckedSupplier(retry, () -> {
                Request request = new Request.Builder().url(endpoint).get().build();
                try (Response response = httpClient.newCall(request).execute()) {
                    if (response.isSuccessful()) {
                        LOGGER.info("等待模式-沙箱endpoint就绪，用户编码：{}，资源ID：{}，endpoint：{}", userCode, resourceId, endpoint);
                        return true;
                    }
                    LOGGER.debug("等待模式-沙箱endpoint未就绪，HTTP状态码：{}，用户编码：{}，资源ID：{}", response.code(), userCode,
                        resourceId);
                    return false;
                }
            }).get();
        }
        catch (Throwable e) {
            LOGGER.warn("等待模式-沙箱endpoint探测最终失败，用户编码：{}，资源ID：{}，原因：{}", userCode, resourceId, e.getMessage());
            return false;
        }
    }

    public boolean waitWorkerReadySync(String targetAgentType, long timeoutMs) {
        LOGGER.debug("开始等待 Gateway worker 就绪，targetAgentType：{}，timeoutMs：{}", targetAgentType, timeoutMs);
        long safeTimeoutMs = Math.max(1L, timeoutMs);
        int maxAttempts = (int) Math.max(1L,
            (safeTimeoutMs + WORKER_READY_POLL_INTERVAL_MS - 1) / WORKER_READY_POLL_INTERVAL_MS);
        RetryConfig config = RetryConfig.custom()
            .maxAttempts(maxAttempts)
            .waitDuration(Duration.ofMillis(WORKER_READY_POLL_INTERVAL_MS))
            .retryOnResult(result ->
                !(result instanceof WorkerRegistry.OnlineAgentCheckResult readyResult) || !readyResult.exists)
            .retryOnException(e -> true)
            .build();
        Retry retry = Retry.of("sandbox-worker-ready-" + targetAgentType, config);

        try {
            WorkerRegistry.OnlineAgentCheckResult result = Retry.decorateCheckedSupplier(retry,
                () -> gatewayWorkerRegistry.hasOnlineAgentType(targetAgentType, true)).get();
            if (result != null && result.exists) {
                LOGGER.info("Gateway worker 已就绪，targetAgentType：{}", targetAgentType);
                return true;
            }
        }
        catch (Throwable e) {
            LOGGER.warn("等待 Gateway worker 就绪超时，targetAgentType：{}，timeoutMs：{}，原因：{}", targetAgentType,
                timeoutMs, e.getMessage());
            return false;
        }

        LOGGER.warn("等待 Gateway worker 就绪超时，targetAgentType：{}，timeoutMs：{}", targetAgentType, timeoutMs);
        return false;
    }

    private void waitWorkerReadySync(String targetAgentType) {
        if (!waitWorkerReadySync(targetAgentType, WORKER_READY_TIMEOUT_MS)) {
            throw new BdpRuntimeException("等待 Gateway worker 就绪超时: " + targetAgentType);
        }
    }

    /**
     * 执行沙箱启动逻辑（在分布式锁内调用）
     *
     * @param userCode            用户编码
     * @param resourceId          资源ID
     * @param sandboxTypeOverride 沙箱类型覆盖值，null 表示由 agentDevType 决定
     * @return 沙箱启动响应数据
     */
    private SandboxLaunchData doLaunchSandbox(String userCode, Long resourceId, SandboxLaunchRouting routing) {
        // 校验运行中沙箱数量是否超过系统参数上限
        checkRunningSandboxLimit();

        SandboxLaunchContext launchContext = sandboxLaunchContextFactory.buildContext(userCode, resourceId,
            routing.getSandboxType());

        SandboxLaunchRequest request = new SandboxLaunchRequest();
        request.setUserCode(userCode);
        // request.setChatId(String.valueOf(System.currentTimeMillis()));
        request.setSandboxType(launchContext.getSandboxType());
        SandboxLeasePolicy leasePolicy = resolveDefaultLeasePolicy();
        Integer autoRelease = leasePolicy == SandboxLeasePolicy.REMOTE_AUTO_EXPIRE
            ? AUTO_RELEASE_REMOTE : AUTO_RELEASE_MANUAL;
        request.setEnvs(launchContext.getEnvs());
        request.setUserInfo(launchContext.getUserInfo());
        String gatewayToken = launchContext.getGatewayToken();

        Date now = new Date();
        SsSandboxRecord record = new SsSandboxRecord();
        record.setResourceId(routing.getEffectiveResourceId());
        record.setUserCode(userCode);
        record.setSandboxType(launchContext.getSandboxType());
        record.setStatus(STATUS_STARTING);
        record.setGatewayToken(gatewayToken);
        record.setAutoRelease(autoRelease);
        record.setLeasePolicy(leasePolicy.name());
        record.setLastAccessTime(now);
        record.setCreateTime(now);
        record.setUpdateTime(now);
        record.setVersion(0);
        record.setLockVersion(0);
        try {
            sandboxRecordMapper.insert(record);
            LOGGER.info("已插入沙箱启动记录：{}", sandboxRef(record));
        }
        catch (DuplicateKeyException e) {
            SsSandboxRecord existingRecord = sandboxRecordMapper.selectActiveByUserAndResource(userCode,
                launchContext.getSandboxType(), routing.getEffectiveResourceId());
            if (existingRecord != null && STATUS_RUNNING.equals(existingRecord.getStatus())
                && StringUtils.isNotBlank(existingRecord.getEndpoint())) {
                LOGGER.info("插入沙箱记录发生唯一键冲突，复用已有沙箱：{}", sandboxRef(existingRecord));
                sandboxMetadataCache.put(toSandboxInfo(existingRecord));
                return buildLaunchData(existingRecord);
            }
            LOGGER.warn("插入沙箱记录发生唯一键冲突，用户编码：{}，沙箱类型：{}，资源ID：{}，已有记录：{}",
                userCode, launchContext.getSandboxType(), routing.getEffectiveResourceId(),
                existingRecord == null ? null : sandboxRef(existingRecord));
            throw new BdpRuntimeException(I18nUtil.get("sandbox.launch.busy"));
        }

        request.setMetadata(buildLaunchMetadata(record));

        LOGGER.info("调用生命周期服务启动沙箱，记录：{}，envKeys：{}", sandboxRef(record),
            launchContext.getEnvs() == null ? List.of() : launchContext.getEnvs().keySet());
        SandboxResponse<SandboxLaunchData> response = sandboxLifecycleFacade.launchSandbox(request);

        if (response == null || !response.isSuccess() || response.getData() == null) {
            String errorMsg = response != null ? StringUtils.defaultIfBlank(response.getMessage(), "启动失败") : "响应为空";
            LOGGER.error("启动沙箱失败，记录：{}，原因：{}", sandboxRef(record), errorMsg);
            int failed = sandboxRecordMapper.updateStatusToFailed(record.getId(), errorMsg, new Date(),
                record.getLockVersion());
            if (failed > 0) {
                incrementVersions(record, true);
            }
            return null;
        }

        SandboxLaunchData launchData = response.getData();
        String boundGatewayToken = StringUtils.defaultIfBlank(launchData.getGatewayToken(),
            resolveLaunchGatewayToken(userCode, launchContext.getSandboxType(), launchData.getSandboxId(),
                gatewayToken));
        Map<String, String> instanceEndpoints = customizeLaunchInstanceEndpoints(launchData, boundGatewayToken);
        String endpoint = SandboxEndpointRecordSupport.resolvePrimaryEndpoint(instanceEndpoints);
        String storedEndpoint = SandboxEndpointRecordSupport.toStorageValue(instanceEndpoints, endpoint);
        launchData.setEndpoint(endpoint);
        launchData.setEndpoints(StringUtils.isNotBlank(endpoint) ? List.of(endpoint) : List.of());
        launchData.setInstanceEndpoints(instanceEndpoints);

        Date lastAccessTime = new Date();
        Date remoteExpiresAt = launchData.getRemoteExpiresAt();
        Date lastRenewAt = remoteExpiresAt != null ? lastAccessTime : null;
        Date nextRenewAt = computeNextRenewAt(remoteExpiresAt);
        int updated = sandboxRecordMapper.updateLaunchSuccess(record.getId(), launchData.getSandboxId(), storedEndpoint,
            boundGatewayToken, launchData.getTimeoutSeconds(), remoteExpiresAt, lastRenewAt, nextRenewAt,
            lastAccessTime, record.getLockVersion());

        record.setStatus(STATUS_RUNNING);
        record.setEndpoint(storedEndpoint);
        record.setSandboxId(launchData.getSandboxId());
        record.setGatewayToken(boundGatewayToken);
        record.setTimeoutSeconds(launchData.getTimeoutSeconds());
        record.setRemoteExpiresAt(remoteExpiresAt);
        record.setLastRenewAt(lastRenewAt);
        record.setNextRenewAt(nextRenewAt);
        record.setLastAccessTime(lastAccessTime);
        if (updated == 0) {
            LOGGER.warn("沙箱启动完成后记录状态已变化，准备释放刚创建的远端沙箱：{}", sandboxRef(record));
            cleanupLaunchedSandboxAfterRecordReleased(record);
            return null;
        }
        incrementVersions(record, true);
        sandboxMetadataCache.put(toSandboxInfo(record));

        registerSandboxEndpoint(userCode, routing, storedEndpoint, boundGatewayToken);
        LOGGER.info("沙箱启动成功，记录：{}，endpoint：{}，timeoutSeconds：{}，remoteExpiresAt：{}，nextRenewAt：{}",
            sandboxRef(record), endpoint, launchData.getTimeoutSeconds(), remoteExpiresAt, nextRenewAt);
        return launchData;
    }

    private Map<String, String> buildLaunchMetadata(SsSandboxRecord record) {
        Map<String, String> metadata = new LinkedHashMap<>();
        if (record == null) {
            return metadata;
        }
        putMetadata(metadata, "userCode", record.getUserCode());
        putMetadata(metadata, "serviceKey", record.getSandboxType());
        putMetadata(metadata, "resourceId", formatMetadataResourceId(record.getResourceId()));
        putMetadata(metadata, "resourceKey", formatMetadataResourceKey(record.getSandboxType(), record.getResourceId()));
        putMetadata(metadata, "recordId", record.getId());
        return metadata;
    }

    private void putMetadata(Map<String, String> metadata, String key, Object value) {
        if (metadata == null || StringUtils.isBlank(key) || value == null) {
            return;
        }
        String stringValue = StringUtils.trimToNull(String.valueOf(value));
        if (stringValue != null) {
            metadata.put(key, sanitizeMetadataLabelValue(stringValue));
        }
    }

    private String formatMetadataResourceId(Long resourceId) {
        if (resourceId == null || resourceId < 0) {
            return null;
        }
        return String.valueOf(resourceId);
    }

    private String formatMetadataResourceKey(String sandboxType, Long resourceId) {
        if (StringUtils.isBlank(sandboxType) || resourceId == null) {
            return null;
        }
        return sandboxType + "_" + resourceId;
    }

    private String sanitizeMetadataLabelValue(String value) {
        String sanitized = value.replaceAll("[^A-Za-z0-9_.-]", "-")
            .replaceAll("^[^A-Za-z0-9]+", "")
            .replaceAll("[^A-Za-z0-9]+$", "");
        if (StringUtils.isBlank(sanitized)) {
            return "value";
        }
        return sanitized.length() <= 63 ? sanitized : sanitized.substring(0, 63)
            .replaceAll("[^A-Za-z0-9]+$", "");
    }

    private SandboxLaunchData buildLaunchData(SsSandboxRecord record) {
        SandboxLaunchData launchData = new SandboxLaunchData();
        Map<String, String> instanceEndpoints = normalizeRecordInstanceEndpoints(record);
        String endpoint = normalizeRecordEndpoint(record);
        String gatewayToken = resolveRecordGatewayToken(record);
        launchData.setEndpoint(endpoint);
        launchData.setSandboxId(record.getSandboxId());
        launchData.setGatewayToken(gatewayToken);
        launchData.setTimeoutSeconds(record.getTimeoutSeconds());
        launchData.setRemoteExpiresAt(record.getRemoteExpiresAt());
        launchData.setEndpoints(StringUtils.isNotBlank(endpoint) ? List.of(endpoint) : List.of());
        launchData.setInstanceEndpoints(instanceEndpoints);
        return launchData;
    }

    /**
     * 校验当前运行中沙箱数量是否超过系统参数 ENABLE_USE_SANDBOX_NUM 限制 若超过则抛出 BdpRuntimeException，提示：业务访问人数较多，请稍后再说
     */
    private void checkRunningSandboxLimit() {
        String limitStr = null;
        try {
            limitStr = byaiSystemConfigService.getDcSystemConfigValueByCode(PARAM_ENABLE_USE_SANDBOX_NUM);
        }
        catch (Exception e) {
            LOGGER.warn("获取系统参数 ENABLE_USE_SANDBOX_NUM 异常，不进行沙箱数量限制", e);
            return;
        }
        if (StringUtils.isBlank(limitStr)) {
            return;
        }
        int limit;
        try {
            limit = Integer.parseInt(limitStr.trim());
        }
        catch (NumberFormatException e) {
            LOGGER.warn("系统参数 ENABLE_USE_SANDBOX_NUM 值非法：{}，不进行沙箱数量限制", limitStr);
            return;
        }
        if (limit <= 0) {
            return;
        }
        int runningCount = sandboxRecordMapper.countRunningSandboxes();
        if (runningCount >= limit) {
            LOGGER.warn("运行中沙箱数量已达上限，当前：{}，限制：{}", runningCount, limit);
            throw new BdpRuntimeException(I18nUtil.get("sandbox.busy.try.later"));
        }
    }

    /**
     * 沙箱心跳：更新当前用户所有运行中沙箱的最后访问时间。
     * 页面心跳不区分沙箱类型，因此按用户维度刷新，避免同一用户的其他沙箱类型被空闲回收。
     *
     * @param resourceId 资源ID
     * @return true-心跳成功，false-未找到运行中的沙箱
     */
    public boolean heartbeat(Long resourceId) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            LOGGER.warn("心跳失败：无法获取当前用户编码，资源ID：{}", resourceId);
            return false;
        }
        return heartbeatRunningSandboxesByUser(userCode, resourceId);
    }

    /**
     * 沙箱心跳：更新指定用户所有运行中沙箱的最后访问时间。
     *
     * @param resourceId 资源ID
     * @return true-心跳成功，false-未找到运行中的沙箱
     */
    public boolean heartbeat(String userCode, Long resourceId) {
        if (StringUtils.isBlank(userCode)) {
            LOGGER.warn("心跳失败：无法获取当前用户编码，资源ID：{}", resourceId);
            return false;
        }
        return heartbeatRunningSandboxesByUser(userCode, resourceId);
    }

    /**
     * running-state 心跳：只刷新当前用户 openclaw 类型运行中沙箱的最后访问时间。
     */
    public boolean heartbeatOpenclawSandbox(String userCode) {
        if (StringUtils.isBlank(userCode)) {
            LOGGER.warn("running-state 心跳失败：无法获取用户编码");
            return false;
        }
        List<SsSandboxRecord> records = sandboxRecordMapper.selectRunningByUserAndSandboxType(userCode,
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);
        if (records == null || records.isEmpty()) {
            LOGGER.warn("running-state 心跳失败：未找到运行中的 openclaw 沙箱记录，用户编码：{}", userCode);
            return false;
        }
        Date now = new Date();
        int updatedCount = 0;
        List<String> skippedRecords = new ArrayList<>();
        for (SsSandboxRecord record : records) {
            SsSandboxRecord updatedRecord = refreshLastAccessTime(record, now);
            if (updatedRecord == null) {
                skippedRecords.add(sandboxRef(record));
                continue;
            }
            sandboxMetadataCache.put(toSandboxInfo(updatedRecord));
            updatedCount++;
        }
        if (!skippedRecords.isEmpty()) {
            LOGGER.warn("running-state 心跳部分记录跳过，用户编码：{}，跳过记录：{}", userCode, skippedRecords);
        }
        if (updatedCount == 0) {
            LOGGER.warn("running-state 心跳失败：openclaw 运行中记录均未更新，用户编码：{}", userCode);
            return false;
        }
        LOGGER.debug("running-state 心跳成功，用户编码：{}，命中记录数：{}，更新记录数：{}，lastAccessTime：{}",
            userCode, records.size(), updatedCount, now);
        return true;
    }

    private boolean heartbeatRunningSandboxesByUser(String userCode, Long resourceId) {
        List<SsSandboxRecord> records = sandboxRecordMapper.selectRunningByUser(userCode);
        if (records == null || records.isEmpty()) {
            LOGGER.warn("心跳失败：未找到运行中的沙箱记录，用户编码：{}，资源ID：{}", userCode, resourceId);
            return false;
        }
        Date now = new Date();
        int updatedCount = 0;
        List<String> skippedRecords = new ArrayList<>();
        for (SsSandboxRecord record : records) {
            SsSandboxRecord updatedRecord = refreshLastAccessTime(record, now);
            if (updatedRecord == null) {
                skippedRecords.add(sandboxRef(record));
                continue;
            }
            sandboxMetadataCache.put(toSandboxInfo(updatedRecord));
            updatedCount++;
        }
        if (!skippedRecords.isEmpty()) {
            LOGGER.warn("沙箱心跳部分记录跳过，用户编码：{}，资源ID：{}，跳过记录：{}", userCode, resourceId, skippedRecords);
        }
        if (updatedCount == 0) {
            LOGGER.warn("沙箱心跳失败：运行中记录均未更新，用户编码：{}，资源ID：{}", userCode, resourceId);
            return false;
        }
        LOGGER.debug("沙箱心跳成功，用户编码：{}，资源ID：{}，命中记录数：{}，更新记录数：{}，lastAccessTime：{}",
            userCode, resourceId, records.size(), updatedCount, now);
        return true;
    }

    /**
     * 手动续约当前运行中的沙箱，同时刷新本地访问时间，避免被本地空闲清理任务回收。
     *
     * @param userCode 用户编码
     * @param resourceId 资源ID，允许为null
     * @return 最新沙箱信息；未命中运行中沙箱时返回 null
     */
    public SandboxInfo renewSandbox(String userCode, Long resourceId) {
        if (StringUtils.isBlank(userCode)) {
            LOGGER.warn("沙箱续约失败：无法获取用户编码，资源ID：{}", resourceId);
            return null;
        }
        SandboxLaunchRouting routing = sandboxLaunchContextFactory.resolveRouting(resourceId, userCode);
        SsSandboxRecord record = sandboxRecordMapper.selectRunningByUserAndResource(userCode,
            routing.getSandboxType(), routing.getEffectiveResourceId());
        if (record == null) {
            LOGGER.warn("沙箱续约失败：未找到运行中的沙箱记录，用户编码：{}，沙箱类型：{}，资源ID：{}", userCode,
                routing.getSandboxType(), routing.getEffectiveResourceId());
            return null;
        }

        Date now = new Date();
        SsSandboxRecord touchedRecord = refreshLastAccessTime(record, now);
        if (touchedRecord == null) {
            LOGGER.warn("沙箱续约失败：刷新本地访问时间失败，记录：{}", sandboxRef(record));
            return null;
        }

        Date remoteExpiresAt = resolveManualRenewExpiresAt(touchedRecord, now);
        SandboxInfo info = toSandboxInfo(touchedRecord);
        info.setRemoteExpiresAt(remoteExpiresAt);
        info.setLastHeartbeatTime(toLocalDateTime(now));

        LOGGER.info("开始手动续约沙箱：{}，remoteExpiresAt：{}，timeoutSeconds：{}", sandboxRef(touchedRecord),
            remoteExpiresAt, touchedRecord.getTimeoutSeconds());
        SandboxResponse<Void> response = sandboxLifecycleFacade.renewSandbox(info);
        if (response == null || !response.isSuccess()) {
            String errorMsg = response != null ? response.getMessage() : "响应为空";
            LOGGER.warn("沙箱手动续约失败：{}，原因：{}", sandboxRef(touchedRecord), errorMsg);
            throw new BdpRuntimeException(StringUtils.defaultIfBlank(errorMsg, "sandbox renew failed"));
        }

        remoteExpiresAt = info.getRemoteExpiresAt() != null ? info.getRemoteExpiresAt() : remoteExpiresAt;

        SsSandboxRecord renewedRecord = persistRenewState(touchedRecord, remoteExpiresAt, now);
        SandboxInfo result = renewedRecord != null ? toSandboxInfo(renewedRecord) : info;
        hydrateGatewayToken(result);
        sandboxMetadataCache.put(result);
        LOGGER.info("沙箱手动续约成功：{}，新的remoteExpiresAt：{}", sandboxRef(touchedRecord), remoteExpiresAt);
        return result;
    }

    /**
     * 根据 userCode 查询当前沙箱信息。
     *
     * @param userCode 用户编码
     * @return 沙箱信息，不存在时返回 null
     */
    public List<SandboxInfo> sandboxInfo(String userCode) {
        if (StringUtils.isBlank(userCode)) {
            return null;
        }
        List<SandboxInfo> cached = sandboxMetadataCache.listByUser(userCode);
        if (cached != null && !cached.isEmpty()) {
            cached.forEach(this::hydrateGatewayToken);
            return cached;
        }
        List<SsSandboxRecord> records = sandboxRecordMapper.selectRunningByUser(userCode);
        if (records == null || records.isEmpty()) {
            return List.of();
        }
        List<SandboxInfo> result = records.stream().map(this::toSandboxInfo).collect(Collectors.toList());
        result.forEach(sandboxMetadataCache::put);
        return result;
    }

    /**
     * 释放沙箱
     *
     * @param userCode 用户编码
     * @param resourceId 资源ID
     */
    public void removeSandbox(String userCode, Long resourceId) {
        String sandboxType = null;
        List<Long> effectiveResourceIds = new ArrayList<>();
        if (resourceId != null) {
            SandboxLaunchRouting routing = sandboxLaunchContextFactory.resolveRouting(resourceId, userCode);
            sandboxType = routing.getSandboxType();
            effectiveResourceIds.add(routing.getEffectiveResourceId());
        }
        List<SsSandboxRecord> records = sandboxRecordMapper.selectRunningByUserAndResources(userCode,
            sandboxType, effectiveResourceIds);
        if (records == null || records.isEmpty()) {
            LOGGER.warn("未找到运行中的沙箱记录，用户编码：{}，资源ID：{}", userCode, resourceId);
            return;
        }
        LOGGER.info("开始手动释放沙箱，用户编码：{}，资源ID：{}，命中记录数：{}，记录：{}",
            userCode, resourceId, records.size(), records.stream().map(this::sandboxRef).collect(Collectors.toList()));
        for (SsSandboxRecord record : records) {
            doRemoveSandbox(record, RELEASE_REASON_MANUAL);
        }
    }

    public void removeSandboxById(Long id) {
        if (id == null) {
            throw new BdpRuntimeException("sandbox record id is required");
        }
        SsSandboxRecord record = sandboxRecordMapper.selectById(id);
        if (record == null) {
            throw new BdpRuntimeException("sandbox record not found");
        }
        if (STATUS_STARTING.equals(record.getStatus())) {
            markStartingSandboxReleased(record, RELEASE_REASON_MANUAL);
            return;
        }
        if (!STATUS_RUNNING.equals(record.getStatus())) {
            LOGGER.warn("沙箱手动释放跳过，记录非可释放状态：{}", sandboxRef(record));
            return;
        }
        doRemoveSandbox(record, RELEASE_REASON_MANUAL);
    }

    public void updateSandboxById(Long id, Integer autoRelease) {
        SsSandboxRecord record = sandboxRecordMapper.selectById(id);
        if (record == null) {
            throw new BdpRuntimeException("sandbox record not found");
        }
        int updated = sandboxRecordMapper.updateAutoRelease(id, autoRelease, record.getLockVersion());
        if (updated == 0) {
            throw new BdpRuntimeException("sandbox record has been changed, please retry");
        }
    }

    /**
     * 处理单个资源的沙箱逻辑 如果资源integrationType为sandbox，查找或创建沙箱，替换agentHomeUrl
     *
     * @param resourceId 资源ID
     * @param sysCode 集成类型
     * @param param 资源参数Map（用于替换agentHomeUrl）
     */
    public void processSandboxForResource(Long resourceId, String sysCode, Map<String, Object> param) {
        if (!SYS_CODE.equals(sysCode) || param == null) {
            return;
        }

        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            LOGGER.warn("无法获取当前用户编码，跳过沙箱处理，资源ID：{}", resourceId);
            return;
        }

        try {
            // 查找已有的运行中沙箱记录
            SandboxLaunchRouting routing = sandboxLaunchContextFactory.resolveRouting(resourceId, userCode);
            SsSandboxRecord existingRecord = sandboxRecordMapper.selectRunningByUserAndResource(userCode,
                routing.getSandboxType(), routing.getEffectiveResourceId());

            if (existingRecord != null && StringUtils.isNotBlank(existingRecord.getEndpoint())) {
                // 已有运行中的沙箱，替换agentHomeUrl（访问时间由前端心跳接口更新）
                String endpoint = normalizeRecordEndpoint(existingRecord);
                param.put("agentHomeUrl", endpoint);
                LOGGER.info("使用已有沙箱，用户编码：{}，资源ID：{}，endpoint：{}", userCode, resourceId, endpoint);
            }
            else {
                // 没有运行中的沙箱，启动新沙箱
                SandboxLaunchData launchData = launchSandbox(userCode, resourceId);
                if (launchData != null && StringUtils.isNotBlank(launchData.getEndpoint())) {
                    param.put("agentHomeUrl", launchData.getEndpoint());
                }
            }
        }
        catch (Exception e) {
            LOGGER.error("处理资源沙箱环境异常，用户编码：{}，资源ID：{}", userCode, resourceId, e);
        }
    }

    /**
     * 批量处理AuthDigitEmployVo列表中的沙箱资源 用于queryMyCreatedAndSubscribedAgents接口
     *
     * @param voList AuthDigitEmployVo列表
     */
    public void processSandboxForAuthDigitEmployVos(List<AuthDigitEmployVo> voList) {
        if (voList == null || voList.isEmpty()) {
            return;
        }

        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            LOGGER.warn("无法获取当前用户编码，跳过AuthDigitEmployVo沙箱处理");
            return;
        }

        // 筛选出integrationType为sandbox的资源
        List<AuthDigitEmployVo> sandboxVos = voList.stream()
            .filter(vo -> INTEGRATION_TYPE_SANDBOX.equals(vo.getCreateType())).collect(Collectors.toList());

        if (sandboxVos.isEmpty()) {
            return;
        }

        // 提取资源ID列表
        List<Long> resourceIds = sandboxVos.stream().map(AuthDigitEmployVo::getId).filter(id -> id != null)
            .collect(Collectors.toList());

        if (resourceIds.isEmpty()) {
            return;
        }

        try {
            // 批量查询已有的运行中沙箱记录
            Map<Long, SandboxLaunchRouting> routingByResourceId = resourceIds.stream()
                .collect(Collectors.toMap(id -> id, id -> sandboxLaunchContextFactory.resolveRouting(id, userCode), (a, b) -> a));
            Map<String, List<Long>> resourceIdsBySandboxType = routingByResourceId.values().stream()
                .collect(Collectors.groupingBy(SandboxLaunchRouting::getSandboxType,
                    Collectors.mapping(SandboxLaunchRouting::getEffectiveResourceId,
                        Collectors.collectingAndThen(Collectors.toList(),
                            ids -> ids.stream().distinct().collect(Collectors.toList())))));

            List<SsSandboxRecord> existingRecords = new ArrayList<>();
            for (Map.Entry<String, List<Long>> entry : resourceIdsBySandboxType.entrySet()) {
                existingRecords.addAll(sandboxRecordMapper.selectRunningByUserAndResources(userCode,
                    entry.getKey(), entry.getValue()));
            }
            Map<String, SsSandboxRecord> recordMap = existingRecords.stream()
                .collect(Collectors.toMap(record -> buildSandboxRecordKey(record.getSandboxType(), record.getResourceId()),
                    r -> r, (a, b) -> a));

            for (AuthDigitEmployVo vo : sandboxVos) {
                Long resourceId = vo.getId();
                if (resourceId == null) {
                    continue;
                }

                SandboxLaunchRouting routing = routingByResourceId.get(resourceId);
                SsSandboxRecord existingRecord = recordMap.get(
                    buildSandboxRecordKey(routing.getSandboxType(), routing.getEffectiveResourceId()));
                if (existingRecord != null && StringUtils.isNotBlank(existingRecord.getEndpoint())) {
                    // 已有运行中的沙箱，替换agentHomeUrl（访问时间由前端心跳接口更新）
                    String endpoint = normalizeRecordEndpoint(existingRecord);
                    vo.setAgentHomeUrl(endpoint);
                    LOGGER.info("AuthDigitEmployVo-使用已有沙箱，用户编码：{}，资源ID：{}，endpoint：{}", userCode, resourceId,
                        endpoint);
                }
                else {
                    // 没有运行中的沙箱，启动新沙箱
                    SandboxLaunchData launchData = launchSandbox(userCode, resourceId);
                    if (launchData != null && StringUtils.isNotBlank(launchData.getEndpoint())) {
                        vo.setAgentHomeUrl(launchData.getEndpoint());
                    }
                }
            }
        }
        catch (Exception e) {
            LOGGER.error("批量处理AuthDigitEmployVo沙箱环境异常，用户编码：{}", userCode, e);
        }
    }

    /**
     * 清理超时的自动释放沙箱
     *
     * @return 清理的沙箱数量
     */
    public SandboxLifecycleJobReport cleanupExpiredSandboxes() {
        SandboxLifecycleJobReport report = new SandboxLifecycleJobReport("cleanup");
        int total = sandboxRecordMapper.countExpiredSandboxes(idleTimeoutMinutes);
        report.setTotalCandidates(total);
        if (total <= 0) {
            return report;
        }

        int cleanedCount = 0;
        int scannedCount = 0;
        Date cursorTime = null;
        Long cursorId = null;
        LOGGER.info("开始清理超时沙箱，候选数量：{}，idleTimeoutMinutes：{}", total, idleTimeoutMinutes);
        while (scannedCount < total) {
            List<SsSandboxRecord> records = sandboxRecordMapper.selectExpiredSandboxesPage(idleTimeoutMinutes,
                cursorTime, cursorId, Math.min(LIFECYCLE_SCAN_PAGE_SIZE, total - scannedCount));
            if (records == null || records.isEmpty()) {
                break;
            }
            SsSandboxRecord last = records.get(records.size() - 1);
            cursorTime = last.getLastAccessTime();
            cursorId = last.getId();
            scannedCount += records.size();
            report.addScannedCount(records.size());
            LOGGER.info("清理超时沙箱分页扫描，pageSize：{}，cursorTime：{}，cursorId：{}，记录：{}", records.size(), cursorTime, cursorId,
                records.stream().map(this::sandboxRef).collect(Collectors.toList()));

            for (SsSandboxRecord record : records) {
                try {
                    LOGGER.info("命中超时释放候选：{}，lastAccessTime：{}，autoRelease：{}",
                        sandboxRef(record), record.getLastAccessTime(), record.getAutoRelease());
                    doRemoveSandbox(record, RELEASE_REASON_AUTO_IDLE_TIMEOUT);
                    cleanedCount++;
                    report.addAffectedSandbox(sandboxRef(record));
                }
                catch (Exception e) {
                    report.addFailedSandbox(sandboxRef(record));
                    LOGGER.error("清理超时沙箱失败：{}", sandboxRef(record), e);
                }
            }
        }

        LOGGER.info("清理超时沙箱完成，候选 {} 个，扫描 {} 个，清理 {} 个沙箱，释放记录：{}，失败记录：{}",
            total, scannedCount, cleanedCount, report.getAffectedSandboxes(), report.getFailedSandboxes());
        return report;
    }

    /**
     * Renew remotely expiring sandboxes that are still active.
     *
     * @return renewed sandbox count
     */
    public SandboxLifecycleJobReport renewDueSandboxes() {
        SandboxLifecycleJobReport report = new SandboxLifecycleJobReport("renew");
        Date now = new Date();
        int total = sandboxRecordMapper.countDueRenewSandboxes(now);
        report.setTotalCandidates(total);
        if (total <= 0) {
            return report;
        }

        int renewedCount = 0;
        int scannedCount = 0;
        Date cursorTime = null;
        Long cursorId = null;
        long idleTimeoutMillis = TimeUnit.MINUTES.toMillis(idleTimeoutMinutes);
        LOGGER.info("开始执行沙箱续约，候选数量：{}，当前时间：{}，renewAheadSeconds：{}", total, now, renewAheadSeconds);
        while (scannedCount < total) {
            List<SsSandboxRecord> records = sandboxRecordMapper.selectDueRenewSandboxesPage(now,
                cursorTime, cursorId, Math.min(LIFECYCLE_SCAN_PAGE_SIZE, total - scannedCount));
            if (records == null || records.isEmpty()) {
                break;
            }
            SsSandboxRecord last = records.get(records.size() - 1);
            cursorTime = last.getNextRenewAt();
            cursorId = last.getId();
            scannedCount += records.size();
            report.addScannedCount(records.size());
            LOGGER.info("沙箱续约分页扫描，pageSize：{}，cursorTime：{}，cursorId：{}，记录：{}", records.size(), cursorTime, cursorId,
                records.stream().map(this::sandboxRef).collect(Collectors.toList()));

            for (SsSandboxRecord record : records) {
                if (AUTO_RELEASE_REMOTE.equals(record.getAutoRelease())
                    && (record.getLastAccessTime() == null
                    || now.getTime() - record.getLastAccessTime().getTime() > idleTimeoutMillis)) {
                    report.addSkippedSandbox(sandboxRef(record));
                    LOGGER.info("沙箱已空闲，跳过远端续约，等待释放策略处理：{}，lastAccessTime：{}",
                        sandboxRef(record), record.getLastAccessTime());
                    continue;
                }
                try {
                    LOGGER.info("开始远端续约：{}，当前remoteExpiresAt：{}，timeoutSeconds：{}，nextRenewAt：{}",
                        sandboxRef(record), record.getRemoteExpiresAt(), record.getTimeoutSeconds(), record.getNextRenewAt());
                    Date remoteExpiresAt = new Date(now.getTime() + TimeUnit.SECONDS.toMillis(record.getTimeoutSeconds()));
                    SandboxInfo info = toSandboxInfo(record);
                    info.setRemoteExpiresAt(remoteExpiresAt);
                    info.setLastHeartbeatTime(java.time.LocalDateTime.now());
                    SandboxResponse<Void> response = sandboxLifecycleFacade.renewSandbox(info);
                    if (response == null || !response.isSuccess()) {
                        report.addFailedSandbox(sandboxRef(record));
                        LOGGER.warn("沙箱远端续约失败：{}，原因：{}", sandboxRef(record),
                            response != null ? response.getMessage() : "响应为空");
                        continue;
                    }
                    remoteExpiresAt = info.getRemoteExpiresAt() != null ? info.getRemoteExpiresAt() : remoteExpiresAt;
                    Date nextRenewAt = computeNextRenewAt(remoteExpiresAt);
                    int updated = sandboxRecordMapper.updateRenewSuccess(record.getId(), remoteExpiresAt, now,
                        nextRenewAt, record.getLockVersion());
                    if (updated == 0) {
                        report.addSkippedSandbox(sandboxRef(record));
                        LOGGER.warn("沙箱远端续约后本地记录已被并发更新，跳过写入：{}", sandboxRef(record));
                        continue;
                    }
                    record.setRemoteExpiresAt(remoteExpiresAt);
                    record.setLastRenewAt(now);
                    record.setNextRenewAt(nextRenewAt);
                    record.setUpdateTime(now);
                    incrementVersions(record, true);
                    sandboxMetadataCache.put(toSandboxInfo(record));
                    renewedCount++;
                    report.addAffectedSandbox(sandboxRef(record));
                    LOGGER.info("沙箱远端续约成功：{}，新的remoteExpiresAt：{}，lastRenewAt：{}，nextRenewAt：{}",
                        sandboxRef(record), remoteExpiresAt, now, nextRenewAt);
                }
                catch (Exception e) {
                    report.addFailedSandbox(sandboxRef(record));
                    LOGGER.error("沙箱远端续约异常：{}", sandboxRef(record), e);
                }
            }
        }
        LOGGER.info("沙箱续约完成，候选 {} 个，扫描 {} 个，成功续约 {} 个，跳过 {} 个，失败 {} 个，成功记录：{}，跳过记录：{}，失败记录：{}",
            total, scannedCount, renewedCount, report.getSkippedCount(), report.getFailedCount(),
            report.getAffectedSandboxes(), report.getSkippedSandboxes(), report.getFailedSandboxes());
        return report;
    }

    /**
     * Reconcile DB lifecycle state with the OpenSandbox runtime. If a non-released
     * record points to a missing sandbox id, close that stale record and start a
     * replacement through the normal launch path.
     *
     * @return restarted sandbox count
     */
    public SandboxLifecycleJobReport reconcileSandboxes() {
        SandboxLifecycleJobReport report = new SandboxLifecycleJobReport("reconcile");
        int total = sandboxRecordMapper.countReconcileSandboxes();
        report.setTotalCandidates(total);
        if (total <= 0) {
            return report;
        }

        String lockValue = UUID.randomUUID().toString();
        boolean locked = false;
        if (reconcileJobLockEnabled) {
            long lockTtlSeconds = Math.max(30L, TimeUnit.MILLISECONDS.toSeconds(reconcileMaxDurationMs) + 30L);
            locked = Boolean.TRUE.equals(RedisUtil.lock(SANDBOX_RECONCILE_JOB_LOCK_KEY, lockValue, lockTtlSeconds));
            if (!locked) {
                LOGGER.info("沙箱一致性检测已有实例执行，本轮跳过，候选数量：{}", total);
                return report;
            }
        }

        int concurrency = Math.max(1, reconcileRemoteConcurrency);
        ExecutorService executorService = Executors.newFixedThreadPool(concurrency);
        AtomicInteger remainingRecords = new AtomicInteger(Math.max(1, reconcileMaxRecordsPerRun));
        long deadline = System.currentTimeMillis() + Math.max(1L, reconcileMaxDurationMs);
        try {
            List<SandboxReconcileGroup> groups = sandboxRecordMapper.selectReconcileGroups(
                Math.max(1, reconcileGroupLimit));
            if (groups == null || groups.isEmpty()) {
                return report;
            }

            LOGGER.info("开始执行沙箱一致性检测，候选数量：{}，分组数量：{}，并发：{}，单轮记录上限：{}",
                total, groups.size(), concurrency, reconcileMaxRecordsPerRun);

            List<Callable<SandboxLifecycleJobReport>> tasks = new ArrayList<>();
            for (SandboxReconcileGroup group : groups) {
                if (group == null || StringUtils.isBlank(group.getUserCode())
                    || StringUtils.isBlank(group.getSandboxType())) {
                    continue;
                }
                tasks.add(() -> reconcileGroup(group, remainingRecords, deadline));
            }

            for (Future<SandboxLifecycleJobReport> future : executorService.invokeAll(tasks,
                Math.max(1L, reconcileMaxDurationMs), TimeUnit.MILLISECONDS)) {
                if (future.isCancelled()) {
                    continue;
                }
                try {
                    report.merge(future.get());
                }
                catch (ExecutionException e) {
                    LOGGER.error("沙箱一致性检测分组任务异常", e.getCause());
                }
            }
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            LOGGER.warn("沙箱一致性检测被中断", e);
        }
        finally {
            executorService.shutdownNow();
            if (reconcileJobLockEnabled && locked) {
                RedisUtil.releaseLock(SANDBOX_RECONCILE_JOB_LOCK_KEY, lockValue);
            }
        }
        LOGGER.info("沙箱一致性检测完成，候选 {} 个，扫描 {} 个，重拉 {} 个，保持 {} 个，失败 {} 个，重拉记录：{}，保持记录：{}，失败记录：{}",
            total, report.getScannedCount(), report.getAffectedCount(), report.getSkippedCount(), report.getFailedCount(),
            report.getAffectedSandboxes(), report.getSkippedSandboxes(), report.getFailedSandboxes());
        return report;
    }

    private SandboxLifecycleJobReport reconcileGroup(SandboxReconcileGroup group, AtomicInteger remainingRecords,
        long deadline) {
        SandboxLifecycleJobReport groupReport = new SandboxLifecycleJobReport("reconcile-group");
        int batchLimit = reserveReconcileRecordLimit(remainingRecords);
        if (batchLimit <= 0 || System.currentTimeMillis() >= deadline) {
            return groupReport;
        }

        List<SsSandboxRecord> records = sandboxRecordMapper.selectReconcileSandboxesByGroup(group.getUserCode(),
            group.getSandboxType(), null, null, batchLimit);
        if (records == null || records.isEmpty()) {
            return groupReport;
        }
        groupReport.addScannedCount(records.size());
        Map<String, SandboxRuntimeInstance> remoteBySandboxId = listRemoteSandboxesByGroup(group);
        if (remoteBySandboxId == null) {
            records.forEach(record -> groupReport.addFailedSandbox(sandboxRef(record)));
            return groupReport;
        }
        LOGGER.info("沙箱一致性检测分组扫描，userCode：{}，sandboxType：{}，DB记录：{}，远端记录：{}",
            group.getUserCode(), group.getSandboxType(), records.size(), remoteBySandboxId.size());

        for (SsSandboxRecord record : records) {
            if (System.currentTimeMillis() >= deadline) {
                groupReport.addSkippedSandbox(sandboxRef(record));
                continue;
            }
            try {
                SandboxRuntimeInstance remoteInstance = remoteBySandboxId.get(record.getSandboxId());
                reconcileRecordFromRemoteMap(record, remoteInstance, groupReport);
            }
            catch (Exception e) {
                groupReport.addFailedSandbox(sandboxRef(record));
                LOGGER.error("沙箱一致性检测异常：{}", sandboxRef(record), e);
            }
        }
        logRemoteOrphans(group, records, remoteBySandboxId);
        return groupReport;
    }

    private int reserveReconcileRecordLimit(AtomicInteger remainingRecords) {
        while (true) {
            int remaining = remainingRecords.get();
            if (remaining <= 0) {
                return 0;
            }
            int reserved = Math.min(Math.max(1, reconcileRecordLimitPerGroup), remaining);
            if (remainingRecords.compareAndSet(remaining, remaining - reserved)) {
                return reserved;
            }
        }
    }

    private Map<String, SandboxRuntimeInstance> listRemoteSandboxesByGroup(SandboxReconcileGroup group) {
        Map<String, SandboxRuntimeInstance> remoteBySandboxId = new LinkedHashMap<>();
        Map<String, String> metadata = Map.of("userCode", group.getUserCode(), "serviceKey", group.getSandboxType());
        int pageNo = 1;
        int pageSize = Math.max(1, reconcileRemotePageSize);
        while (true) {
            SandboxResponse<SandboxRuntimePage<SandboxRuntimeInstance>> response =
                sandboxLifecycleFacade.listSandboxesByMetadata(metadata, pageNo, pageSize);
            if (response == null || !response.isSuccess() || response.getData() == null) {
                LOGGER.warn("沙箱一致性检测远端分页查询失败，metadata：{}，pageNo：{}，原因：{}",
                    metadata, pageNo, response != null ? response.getMessage() : "响应为空");
                return null;
            }
            SandboxRuntimePage<SandboxRuntimeInstance> page = response.getData();
            for (SandboxRuntimeInstance instance : page.safeItems()) {
                if (instance != null && StringUtils.isNotBlank(instance.getSandboxId())) {
                    remoteBySandboxId.put(instance.getSandboxId(), instance);
                }
            }
            if (!page.isHasNext() || page.safeItems().isEmpty()) {
                break;
            }
            pageNo++;
        }
        return remoteBySandboxId;
    }

    private void reconcileRecordFromRemoteMap(SsSandboxRecord record, SandboxRuntimeInstance remoteInstance,
        SandboxLifecycleJobReport report) {
        if (remoteInstance != null && !StringUtils.equals(record.getSandboxId(), remoteInstance.getSandboxId())) {
            report.addFailedSandbox(sandboxRef(record));
            LOGGER.warn("沙箱一致性检测发现sandboxId不一致，保留当前状态：{}，remoteSandboxId={}，remoteState={}",
                sandboxRef(record), remoteInstance.getSandboxId(), remoteInstance.getState());
            return;
        }
        if (remoteInstance != null && Boolean.TRUE.equals(remoteInstance.getReusable())) {
            String originalEndpoint = record.getEndpoint();
            String originalGatewayToken = record.getGatewayToken();
            reconcileRecordWithRemote(record, remoteInstance);
            sandboxMetadataCache.put(toSandboxInfo(record));
            refreshRegisteredEndpointIfBindingChanged(record, originalEndpoint, originalGatewayToken);
            report.addSkippedSandbox(sandboxRef(record));
            LOGGER.info("远端沙箱状态已同步：{}，remoteState={}，remoteExpiresAt={}，remoteCreatedAt={}",
                sandboxRef(record), remoteInstance.getState(), remoteInstance.getExpiresAt(),
                remoteInstance.getCreatedAt());
            return;
        }
        reconcileMissingRemote(record, remoteInstance, report);
    }

    private void reconcileMissingRemote(SsSandboxRecord record, SandboxRuntimeInstance remoteInstance,
        SandboxLifecycleJobReport report) {
        LOGGER.warn("沙箱一致性检测发现远端沙箱不存在或不可复用，准备重新拉起：{}，remoteState={}",
            sandboxRef(record), remoteInstance != null ? remoteInstance.getState() : null);
        int marked = sandboxRecordMapper.markReleased(record.getId(), RELEASE_REASON_REMOTE_MISSING,
            new Date(), record.getLockVersion());
        if (marked == 0) {
            report.addSkippedSandbox(sandboxRef(record));
            LOGGER.warn("沙箱一致性检测跳过重拉，记录状态已变化：{}", sandboxRef(record));
            return;
        }
        incrementVersions(record, true);
        sandboxMetadataCache.evict(record.getUserCode(), record.getSandboxType());
        SandboxLaunchData launchData = sandboxUserContextRunner.callAsUser(record.getUserCode(),
            () -> launchSandbox(record.getUserCode(), record.getResourceId()));
        if (launchData != null && StringUtils.isNotBlank(launchData.getEndpoint())) {
            report.addAffectedSandbox(sandboxRef(record) + " -> newSandboxId=" + launchData.getSandboxId());
            LOGGER.info("沙箱一致性检测重拉成功，旧记录：{}，新sandboxId：{}，新endpoint：{}",
                sandboxRef(record), launchData.getSandboxId(), launchData.getEndpoint());
        }
        else {
            report.addFailedSandbox(sandboxRef(record));
            LOGGER.warn("沙箱一致性检测重拉失败，旧记录：{}", sandboxRef(record));
        }
    }

    private void logRemoteOrphans(SandboxReconcileGroup group, List<SsSandboxRecord> records,
        Map<String, SandboxRuntimeInstance> remoteBySandboxId) {
        if (remoteBySandboxId == null || remoteBySandboxId.isEmpty()) {
            return;
        }
        if (group != null && group.getRecordCount() != null && group.getRecordCount() > records.size()) {
            LOGGER.info("沙箱一致性检测跳过远端孤儿判断，分组 DB 记录未完整扫描，userCode：{}，sandboxType：{}，扫描：{}，总数：{}",
                group.getUserCode(), group.getSandboxType(), records.size(), group.getRecordCount());
            return;
        }
        Map<String, SsSandboxRecord> dbBySandboxId = records == null ? Map.of() : records.stream()
            .filter(record -> record != null && StringUtils.isNotBlank(record.getSandboxId()))
            .collect(Collectors.toMap(SsSandboxRecord::getSandboxId, record -> record, (left, right) -> left));
        List<String> orphanSamples = remoteBySandboxId.values().stream()
            .filter(instance -> instance != null && !dbBySandboxId.containsKey(instance.getSandboxId()))
            .limit(20)
            .map(instance -> instance.getSandboxId() + ":" + instance.getState())
            .toList();
        if (!orphanSamples.isEmpty()) {
            LOGGER.warn("沙箱一致性检测发现远端孤儿候选，userCode：{}，sandboxType：{}，样例：{}",
                group.getUserCode(), group.getSandboxType(), orphanSamples);
        }
    }

    private void reconcileRecordWithRemote(SsSandboxRecord record, SandboxRuntimeInstance remoteInstance) {
        Date remoteExpiresAt = toDate(remoteInstance.getExpiresAt());
        Date remoteCreatedAt = toDate(remoteInstance.getCreatedAt());
        Integer timeoutSeconds = resolveRemoteTimeoutSeconds(remoteInstance, record.getTimeoutSeconds());
        Date nextRenewAt = computeNextRenewAt(remoteExpiresAt);
        String status = mapRemoteStateToRecordStatus(remoteInstance.getState());
        String gatewayToken = resolveReconciledGatewayToken(record, remoteInstance);
        SandboxEndpointRecordSupport.EndpointRecordParseResult endpointParseResult =
            SandboxEndpointRecordSupport.parseEndpointRecord(record.getEndpoint());
        Map<String, String> instanceEndpoints = endpointParseResult.malformedJson()
            ? endpointParseResult.instanceEndpoints()
            : normalizeInstanceEndpoints(endpointParseResult.instanceEndpoints(), gatewayToken);
        String endpoint = SandboxEndpointRecordSupport.resolvePrimaryEndpoint(instanceEndpoints);
        String storedEndpoint = endpointParseResult.malformedJson()
            ? record.getEndpoint()
            : SandboxEndpointRecordSupport.toStorageValue(instanceEndpoints, endpoint);
        if (!hasReconcileChange(record, status, storedEndpoint, gatewayToken, remoteExpiresAt, remoteCreatedAt,
            timeoutSeconds, nextRenewAt)) {
            return;
        }
        Date updateTime = new Date();
        int updated = sandboxRecordMapper.updateReconcileSuccess(record.getId(), status, storedEndpoint, gatewayToken,
            remoteExpiresAt, remoteCreatedAt, timeoutSeconds, nextRenewAt, updateTime, record.getLockVersion());
        if (updated == 0) {
            LOGGER.warn("沙箱一致性检测写入跳过，记录已被并发更新或处于不可同步状态：{}", sandboxRef(record));
            return;
        }
        record.setStatus(status);
        record.setEndpoint(storedEndpoint);
        record.setGatewayToken(gatewayToken);
        record.setRemoteExpiresAt(remoteExpiresAt);
        record.setCreateTime(remoteCreatedAt != null ? remoteCreatedAt : record.getCreateTime());
        record.setTimeoutSeconds(timeoutSeconds);
        record.setNextRenewAt(nextRenewAt);
        record.setUpdateTime(updateTime);
        incrementVersions(record, true);
    }

    private boolean hasReconcileChange(SsSandboxRecord record, String status, String endpointStorage, String gatewayToken,
        Date remoteExpiresAt, Date remoteCreatedAt, Integer timeoutSeconds, Date nextRenewAt) {
        return !Objects.equals(record.getStatus(), status)
            || !Objects.equals(record.getEndpoint(), endpointStorage)
            || !Objects.equals(record.getGatewayToken(), gatewayToken)
            || !Objects.equals(record.getRemoteExpiresAt(), remoteExpiresAt)
            || (remoteCreatedAt != null && !Objects.equals(record.getCreateTime(), remoteCreatedAt))
            || !Objects.equals(record.getTimeoutSeconds(), timeoutSeconds)
            || !Objects.equals(record.getNextRenewAt(), nextRenewAt);
    }

    private String resolveReconciledGatewayToken(SsSandboxRecord record, SandboxRuntimeInstance remoteInstance) {
        String remoteGatewayToken = null;
        if (remoteInstance != null && remoteInstance.getMetadata() != null) {
            remoteGatewayToken = StringUtils.trimToNull(remoteInstance.getMetadata().get(GATEWAY_TOKEN_METADATA_KEY));
        }
        return StringUtils.defaultIfBlank(remoteGatewayToken, resolveRecordGatewayToken(record));
    }

    private void refreshRegisteredEndpointIfBindingChanged(SsSandboxRecord record, String originalEndpoint,
        String originalGatewayToken) {
        if (record == null) {
            return;
        }
        if (Objects.equals(originalEndpoint, record.getEndpoint())
            && Objects.equals(originalGatewayToken, record.getGatewayToken())) {
            return;
        }
        registerSandboxEndpoint(record.getUserCode(),
            new SandboxLaunchRouting(record.getSandboxType(), record.getResourceId()),
            record.getEndpoint(), record.getGatewayToken());
    }

    private Integer resolveRemoteTimeoutSeconds(SandboxRuntimeInstance remoteInstance, Integer fallbackTimeoutSeconds) {
        if (fallbackTimeoutSeconds != null && fallbackTimeoutSeconds > 0) {
            return fallbackTimeoutSeconds;
        }
        if (remoteInstance != null && remoteInstance.getCreatedAt() != null && remoteInstance.getExpiresAt() != null) {
            long seconds = java.time.temporal.ChronoUnit.SECONDS.between(
                remoteInstance.getCreatedAt(), remoteInstance.getExpiresAt());
            if (seconds > 0 && seconds <= Integer.MAX_VALUE) {
                return (int) seconds;
            }
        }
        return fallbackTimeoutSeconds;
    }

    private Date toDate(OffsetDateTime dateTime) {
        return dateTime != null ? Date.from(dateTime.toInstant()) : null;
    }

    private String mapRemoteStateToRecordStatus(String remoteState) {
        if (StringUtils.isBlank(remoteState)) {
            return STATUS_RUNNING;
        }
        String normalized = remoteState.trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "pending", "creating", "starting" -> STATUS_STARTING;
            case "running", "ready" -> STATUS_RUNNING;
            default -> STATUS_RUNNING;
        };
    }

    /**
     * 执行沙箱释放操作（远程调用+更新本地记录）
     *
     * @param record 沙箱记录
     */
    private void doRemoveSandbox(SsSandboxRecord record, String releaseReason) {
        Date now = new Date();
        int marked = sandboxRecordMapper.markReleasing(record.getId(), releaseReason, now, record.getLockVersion());
        if (marked == 0 && STATUS_RUNNING.equals(record.getStatus())) {
            LOGGER.warn("沙箱释放跳过，记录状态已变化：{}", sandboxRef(record));
            return;
        }
        record.setStatus(STATUS_RELEASING);
        record.setUpdateTime(now);
        if (marked > 0) {
            incrementVersions(record, true);
        }
        try {
            LOGGER.info("开始释放沙箱：{}，releaseReason：{}", sandboxRef(record), releaseReason);
            String lockKey = SANDBOX_LAUNCH_LOCK_PREFIX + record.getUserCode() + ":" + record.getSandboxType() + ":" + record.getResourceId();
            RedisUtil.del(lockKey);
            SandboxResponse<Void> response = sandboxLifecycleFacade.removeSandbox(toSandboxInfo(record));
            if (response == null || !response.isSuccess()) {
                LOGGER.warn("远程释放沙箱返回失败：{}，原因：{}", sandboxRef(record),
                    response != null ? response.getMessage() : "响应为空");
            }
        }
        catch (Exception e) {
            LOGGER.error("远程释放沙箱失败：{}", sandboxRef(record), e);
        }
        // 无论远程调用是否成功，都更新本地记录状态
        Date releaseTime = new Date();
        int released = sandboxRecordMapper.updateStatusToReleased(record.getId(), releaseReason, releaseTime,
            record.getLockVersion());
        if (released == 0) {
            LOGGER.warn("沙箱释放完成后本地记录已被并发更新，跳过标记已释放：{}", sandboxRef(record));
            return;
        }
        record.setStatus(STATUS_RELEASED);
        record.setReleaseReason(releaseReason);
        record.setReleaseTime(releaseTime);
        record.setUpdateTime(releaseTime);
        incrementVersions(record, true);
        sandboxMetadataCache.evict(record.getUserCode(), record.getSandboxType());
        unregisterSandboxEndpoint(record.getUserCode(), record.getSandboxType());
        LOGGER.info("沙箱释放完成：{}，releaseReason：{}", sandboxRef(record), releaseReason);
    }

    private void markStartingSandboxReleased(SsSandboxRecord record, String releaseReason) {
        Date now = new Date();
        int marked = sandboxRecordMapper.markStartingReleased(record.getId(), releaseReason, now,
            record.getLockVersion());
        if (marked == 0) {
            SsSandboxRecord latestRecord = sandboxRecordMapper.selectById(record.getId());
            if (latestRecord != null && STATUS_RUNNING.equals(latestRecord.getStatus())) {
                LOGGER.info("启动中沙箱释放时记录已运行，改用运行中释放流程：{}", sandboxRef(latestRecord));
                doRemoveSandbox(latestRecord, releaseReason);
                return;
            }
            LOGGER.warn("启动中沙箱释放跳过，记录状态已变化：{}", sandboxRef(latestRecord));
            return;
        }
        record.setStatus(STATUS_RELEASED);
        record.setReleaseReason(releaseReason);
        record.setReleaseTime(now);
        record.setUpdateTime(now);
        incrementVersions(record, true);
        String lockKey = SANDBOX_LAUNCH_LOCK_PREFIX + record.getUserCode() + ":" + record.getSandboxType() + ":"
            + record.getResourceId();
        RedisUtil.del(lockKey);
        sandboxMetadataCache.evict(record.getUserCode(), record.getSandboxType());
        unregisterSandboxEndpoint(record.getUserCode(), record.getSandboxType());
        LOGGER.info("启动中沙箱已标记释放：{}，releaseReason：{}", sandboxRef(record), releaseReason);
    }

    private void cleanupLaunchedSandboxAfterRecordReleased(SsSandboxRecord record) {
        try {
            SandboxResponse<Void> response = sandboxLifecycleFacade.removeSandbox(toSandboxInfo(record));
            if (response == null || !response.isSuccess()) {
                LOGGER.warn("释放已取消启动的远端沙箱返回失败：{}，原因：{}", sandboxRef(record),
                    response != null ? response.getMessage() : "响应为空");
            }
        }
        catch (Exception e) {
            LOGGER.error("释放已取消启动的远端沙箱异常：{}", sandboxRef(record), e);
        }
        sandboxMetadataCache.evict(record.getUserCode(), record.getSandboxType());
        unregisterSandboxEndpoint(record.getUserCode(), record.getSandboxType());
    }

    private void registerSandboxEndpoint(String userCode, SandboxLaunchRouting routing, String endpoint,
        String gatewayToken) {
        String openclawEndpoint = SandboxEndpointRecordSupport.resolveInstanceEndpoint(
            normalizeRecordInstanceEndpoints(endpoint, gatewayToken), SandboxEndpointRecordSupport.OPENCLAW_INSTANCE);
        if (StringUtils.isBlank(openclawEndpoint)) {
            LOGGER.warn("沙箱endpoint为空，跳过服务注册，用户编码：{}，沙箱类型：{}", userCode,
                routing != null ? routing.getSandboxType() : null);
            return;
        }
        String serviceName = buildSandboxWorkerAgentType(userCode, routing != null ? routing.getSandboxType() : null);
        if (StringUtils.isBlank(serviceName)) {
            LOGGER.warn("无法解析沙箱worker_agent_type，跳过服务注册，用户编码：{}，沙箱类型：{}", userCode,
                routing != null ? routing.getSandboxType() : null);
            return;
        }

        try {
            SandboxEndpointRegistryTarget target = new SandboxEndpointRegistryTargetResolver()
                .resolve(openclawEndpoint);
            Map<String, Object> metadata = new SandboxEndpointRegistryMetadataFactory(gatewayToken)
                .build();
            cleanupSandboxRegistryKeys(serviceName);

            ServiceRegistry registry = new ServiceRegistry(redisClient);
            registry.registerOnly(serviceName, target.protocol(), target.host(), target.port(), target.pathPrefix(), 1, metadata);
            LOGGER.info("沙箱endpoint注册成功，serviceName={}，endpoint={}，protocol={}，host={}，port={}，pathPrefix={}",
                serviceName, openclawEndpoint, target.protocol(), target.host(), target.port(), target.pathPrefix());
        }
        catch (Exception e) {
            LOGGER.error("沙箱endpoint注册失败，不影响启动返回，serviceName={}，endpoint={}，reason={}",
                serviceName, openclawEndpoint, e.getMessage(), e);
        }
    }

    private void unregisterSandboxEndpoint(String userCode, String sandboxType) {
        String serviceName = buildSandboxWorkerAgentType(userCode, sandboxType);
        if (StringUtils.isBlank(serviceName)) {
            return;
        }
        try {
            cleanupSandboxRegistryKeys(serviceName);
            LOGGER.info("沙箱endpoint反注册完成，serviceName={}，userCode={}，sandboxType={}",
                serviceName, userCode, sandboxType);
        }
        catch (Exception e) {
            LOGGER.error("沙箱endpoint反注册失败，serviceName={}，userCode={}，sandboxType={}，reason={}",
                serviceName, userCode, sandboxType, e.getMessage(), e);
        }
    }

    private String buildSandboxWorkerAgentType(String userCode, String sandboxType) {
        if (StringUtils.isBlank(userCode) || StringUtils.isBlank(sandboxType)) {
            return null;
        }
        if (SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE.equals(sandboxType)) {
            return WorkerAgentType.BYCLAW_EXE.getCode() + "_" + userCode;
        }
        if (SandboxLaunchRouting.BYCLAW_CODE_AGENT_SANDBOX_TYPE.equals(sandboxType)) {
            return WorkerAgentType.BYCLAW_CODE.getCode() + "_" + userCode;
        }
        return sandboxType + "_" + userCode;
    }

    private void cleanupSandboxRegistryKeys(String serviceName) {
        try (Jedis jedis = redisClient.getResource()) {
            String instancesKey = Constants.RegistryKeys.sdInstanceDetails(serviceName);
            String activeKey = Constants.RegistryKeys.sdActiveInstances(serviceName);
            Map<String, String> instanceMap = jedis.hgetAll(instancesKey);
            if (instanceMap != null && !instanceMap.isEmpty()) {
                String[] instanceIds = instanceMap.keySet().toArray(new String[0]);
                jedis.hdel(instancesKey, instanceIds);
                jedis.zrem(activeKey, instanceIds);
            }
            jedis.del(instancesKey);
            jedis.del(activeKey);
            jedis.srem(Constants.RegistryKeys.SD_SERVICES, serviceName);
        }
    }

    private String buildSandboxRecordKey(String sandboxType, Long resourceId) {
        return sandboxType + ":" + resourceId;
    }

    private SandboxLeasePolicy resolveDefaultLeasePolicy() {
        return SandboxLeasePolicy.fromDbValue(defaultLeasePolicy);
    }

    private Date computeNextRenewAt(Date remoteExpiresAt) {
        if (remoteExpiresAt == null) {
            return null;
        }
        long nextRenewMillis = remoteExpiresAt.getTime() - TimeUnit.SECONDS.toMillis(Math.max(0L, renewAheadSeconds));
        return new Date(Math.max(System.currentTimeMillis(), nextRenewMillis));
    }

    private SsSandboxRecord refreshLastAccessTime(SsSandboxRecord record, Date now) {
        if (record == null || now == null) {
            return null;
        }
        int updated = sandboxRecordMapper.updateLastAccessTime(record.getId(), now, record.getLockVersion());
        if (updated > 0) {
            record.setLastAccessTime(now);
            record.setUpdateTime(now);
            incrementVersions(record, false);
            return record;
        }

        SsSandboxRecord latestRecord = sandboxRecordMapper.selectById(record.getId());
        if (latestRecord == null || !STATUS_RUNNING.equals(latestRecord.getStatus())) {
            return null;
        }
        updated = sandboxRecordMapper.updateLastAccessTime(latestRecord.getId(), now, latestRecord.getLockVersion());
        if (updated == 0) {
            return null;
        }
        latestRecord.setLastAccessTime(now);
        latestRecord.setUpdateTime(now);
        incrementVersions(latestRecord, false);
        return latestRecord;
    }

    private Date resolveManualRenewExpiresAt(SsSandboxRecord record, Date now) {
        if (record == null || now == null || record.getTimeoutSeconds() == null || record.getTimeoutSeconds() <= 0) {
            return record != null ? record.getRemoteExpiresAt() : null;
        }
        return new Date(now.getTime() + TimeUnit.SECONDS.toMillis(record.getTimeoutSeconds()));
    }

    private SsSandboxRecord persistRenewState(SsSandboxRecord record, Date remoteExpiresAt, Date renewTime) {
        if (record == null || renewTime == null) {
            return null;
        }
        Date nextRenewAt = computeNextRenewAt(remoteExpiresAt);
        int updated = sandboxRecordMapper.updateRenewSuccess(record.getId(), remoteExpiresAt, renewTime, nextRenewAt,
            record.getLockVersion());
        if (updated > 0) {
            record.setRemoteExpiresAt(remoteExpiresAt);
            record.setLastRenewAt(renewTime);
            record.setNextRenewAt(nextRenewAt);
            record.setUpdateTime(renewTime);
            incrementVersions(record, true);
            return record;
        }

        SsSandboxRecord latestRecord = sandboxRecordMapper.selectById(record.getId());
        if (latestRecord == null || !STATUS_RUNNING.equals(latestRecord.getStatus())) {
            LOGGER.warn("沙箱手动续约后本地记录已变化，跳过续约元数据写入：{}", sandboxRef(record));
            return null;
        }
        updated = sandboxRecordMapper.updateRenewSuccess(latestRecord.getId(), remoteExpiresAt, renewTime,
            nextRenewAt, latestRecord.getLockVersion());
        if (updated == 0) {
            LOGGER.warn("沙箱手动续约后本地记录并发更新，跳过续约元数据写入：{}", sandboxRef(latestRecord));
            return null;
        }
        latestRecord.setRemoteExpiresAt(remoteExpiresAt);
        latestRecord.setLastRenewAt(renewTime);
        latestRecord.setNextRenewAt(nextRenewAt);
        latestRecord.setUpdateTime(renewTime);
        incrementVersions(latestRecord, true);
        return latestRecord;
    }

    private SandboxInfo toSandboxInfo(SsSandboxRecord record) {
        if (record == null) {
            return null;
        }
        String gatewayToken = resolveRecordGatewayToken(record);
        Map<String, String> instanceEndpoints = normalizeRecordInstanceEndpoints(record);
        String endpoint = normalizeRecordEndpoint(record);
        List<String> endpoints = StringUtils.isNotBlank(endpoint) ? List.of(endpoint) : List.of();
        return SandboxInfo.builder()
            .sandboxId(record.getSandboxId())
            .userCode(record.getUserCode())
            .sandboxType(record.getSandboxType())
            .endpoints(endpoints)
            .instanceEndpoints(instanceEndpoints)
            .gatewayToken(gatewayToken)
            .timeoutSeconds(record.getTimeoutSeconds())
            .remoteExpiresAt(record.getRemoteExpiresAt())
            .createdTime(toLocalDateTime(record.getCreateTime()))
            .lastHeartbeatTime(toLocalDateTime(record.getLastAccessTime()))
            .build();
    }

    private String resolveLaunchGatewayToken(String userCode, String sandboxType, String sandboxId,
        String fallbackGatewayToken) {
        if (StringUtils.isBlank(userCode) || StringUtils.isBlank(sandboxType) || StringUtils.isBlank(sandboxId)) {
            return fallbackGatewayToken;
        }
        SsSandboxRecord existingRecord = sandboxRecordMapper.selectLatestBySandboxId(userCode, sandboxType, sandboxId);
        String existingGatewayToken = resolveRecordGatewayToken(existingRecord);
        return StringUtils.defaultIfBlank(existingGatewayToken, fallbackGatewayToken);
    }

    private String resolveRecordGatewayToken(SsSandboxRecord record) {
        if (record == null) {
            return null;
        }
        String gatewayToken = StringUtils.trimToNull(record.getGatewayToken());
        if (gatewayToken != null) {
            return gatewayToken;
        }
        return extractGatewayToken(record.getEndpoint());
    }

    private String normalizeRecordEndpoint(SsSandboxRecord record) {
        if (record == null || StringUtils.isBlank(record.getEndpoint())) {
            return record != null ? record.getEndpoint() : null;
        }
        return SandboxEndpointRecordSupport.resolvePrimaryEndpoint(
            normalizeRecordInstanceEndpoints(record.getEndpoint(), resolveRecordGatewayToken(record)));
    }

    private String normalizeRecordEndpoint(String endpoint, String gatewayToken) {
        if (StringUtils.isBlank(endpoint) || StringUtils.isBlank(gatewayToken)) {
            return endpoint;
        }
        return new SandboxEndpointUrlCustomizer(gatewayToken).bindToken(endpoint);
    }

    private void hydrateGatewayToken(SandboxInfo info) {
        if (info == null || StringUtils.isNotBlank(info.getGatewayToken())) {
            return;
        }
        info.setGatewayToken(extractGatewayToken(info.getEndpoints()));
    }

    private String extractGatewayToken(List<String> endpoints) {
        if (endpoints == null || endpoints.isEmpty()) {
            return null;
        }
        for (String endpoint : endpoints) {
            String token = extractGatewayToken(endpoint);
            if (StringUtils.isNotBlank(token)) {
                return token;
            }
        }
        return null;
    }

    private String extractGatewayToken(String endpoint) {
        if (StringUtils.isBlank(endpoint)) {
            return null;
        }
        try {
            SandboxEndpointRecordSupport.EndpointRecordParseResult endpointParseResult =
                SandboxEndpointRecordSupport.parseEndpointRecord(endpoint);
            if (endpointParseResult.malformedJson()) {
                return null;
            }
            String rawQuery = URI.create(StringUtils.defaultIfBlank(
                SandboxEndpointRecordSupport.resolvePrimaryEndpoint(endpointParseResult.instanceEndpoints()),
                endpoint)).getRawQuery();
            if (StringUtils.isBlank(rawQuery)) {
                return null;
            }
            for (String pair : rawQuery.split("&")) {
                String[] parts = pair.split("=", 2);
                if (parts.length == 2 && "token".equals(URLDecoder.decode(parts[0], StandardCharsets.UTF_8))) {
                    return URLDecoder.decode(parts[1], StandardCharsets.UTF_8);
                }
            }
        }
        catch (IllegalArgumentException e) {
            LOGGER.warn("解析沙箱endpoint token失败，endpoint：{}，原因：{}", endpoint, e.getMessage());
        }
        return null;
    }

    private Map<String, String> customizeLaunchInstanceEndpoints(SandboxLaunchData launchData, String gatewayToken) {
        Map<String, String> existing = launchData != null ? launchData.getInstanceEndpoints() : null;
        java.util.LinkedHashMap<String, String> source = SandboxEndpointRecordSupport.normalizeInstanceEndpoints(existing);
        if (source.isEmpty()) {
            String endpoint = launchData != null ? StringUtils.trimToNull(launchData.getEndpoint()) : null;
            if (endpoint == null && launchData != null && launchData.getEndpoints() != null && !launchData.getEndpoints().isEmpty()) {
                endpoint = StringUtils.trimToNull(launchData.getEndpoints().getFirst());
            }
            if (endpoint != null) {
                source.put(SandboxEndpointRecordSupport.OPENCLAW_INSTANCE, endpoint);
            }
        }
        java.util.LinkedHashMap<String, String> customized = new java.util.LinkedHashMap<>();
        source.forEach((instance, endpoint) -> {
            String endpointValue = customizeInstanceEndpoint(instance, endpoint, gatewayToken);
            if (StringUtils.isNotBlank(endpointValue)) {
                customized.put(instance, endpointValue);
            }
        });
        return SandboxEndpointRecordSupport.normalizeInstanceEndpoints(customized);
    }

    private Map<String, String> normalizeRecordInstanceEndpoints(SsSandboxRecord record) {
        return normalizeRecordInstanceEndpoints(record != null ? record.getEndpoint() : null,
            resolveRecordGatewayToken(record));
    }

    private Map<String, String> normalizeRecordInstanceEndpoints(String endpointField, String gatewayToken) {
        SandboxEndpointRecordSupport.EndpointRecordParseResult endpointParseResult =
            SandboxEndpointRecordSupport.parseEndpointRecord(endpointField);
        if (endpointParseResult.malformedJson()) {
            return endpointParseResult.instanceEndpoints();
        }
        return normalizeInstanceEndpoints(endpointParseResult.instanceEndpoints(), gatewayToken);
    }

    private Map<String, String> normalizeInstanceEndpoints(Map<String, String> parsed, String gatewayToken) {
        java.util.LinkedHashMap<String, String> normalized = new java.util.LinkedHashMap<>();
        parsed.forEach((instance, endpoint) -> {
            String endpointValue = bindGatewayToken(endpoint, gatewayToken);
            if (StringUtils.isNotBlank(endpointValue)) {
                normalized.put(instance, endpointValue);
            }
        });
        return SandboxEndpointRecordSupport.normalizeInstanceEndpoints(normalized);
    }

    private String customizeInstanceEndpoint(String instance, String endpoint, String gatewayToken) {
        if (StringUtils.isBlank(endpoint)) {
            return endpoint;
        }
        if (StringUtils.equalsIgnoreCase(instance, SandboxEndpointRecordSupport.OPENCLAW_INSTANCE)) {
            return new SandboxEndpointUrlCustomizer(gatewayToken).toAccessEndpoint(endpoint);
        }
        return bindGatewayToken(endpoint, gatewayToken);
    }

    private String bindGatewayToken(String endpoint, String gatewayToken) {
        if (StringUtils.isBlank(endpoint) || StringUtils.isBlank(gatewayToken)) {
            return endpoint;
        }
        return new SandboxEndpointUrlCustomizer(gatewayToken).bindToken(endpoint);
    }

    private java.time.LocalDateTime toLocalDateTime(Date date) {
        if (date == null) {
            return null;
        }
        return java.time.LocalDateTime.ofInstant(date.toInstant(), java.time.ZoneId.systemDefault());
    }

    private void incrementVersions(SsSandboxRecord record, boolean lifecycleChanged) {
        if (record == null) {
            return;
        }
        record.setLockVersion(record.getLockVersion() == null ? 1 : record.getLockVersion() + 1);
        if (lifecycleChanged) {
            record.setVersion(record.getVersion() == null ? 1 : record.getVersion() + 1);
        }
    }

    private String sandboxRef(SsSandboxRecord record) {
        if (record == null) {
            return "record=null";
        }
        return "recordId=" + record.getId()
            + ", sandboxId=" + record.getSandboxId()
            + ", userCode=" + record.getUserCode()
            + ", sandboxType=" + record.getSandboxType()
            + ", resourceId=" + record.getResourceId()
            + ", status=" + record.getStatus()
            + ", version=" + record.getVersion()
            + ", lockVersion=" + record.getLockVersion();
    }
}
