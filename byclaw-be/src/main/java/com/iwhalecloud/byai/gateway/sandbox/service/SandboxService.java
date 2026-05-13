package com.iwhalecloud.byai.gateway.sandbox.service;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import com.iwhaleai.byai.framework.core.WorkerRegistry;
import com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest;
import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
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

/**
 * 沙箱服务 提供沙箱环境的启动、释放、查询和自动清理等功能
 */
@Service
public class SandboxService {

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxService.class);

    /** 沙箱状态：运行中 */
    private static final String STATUS_RUNNING = "RUNNING";

    /** 沙箱状态：已释放 */
    private static final String STATUS_RELEASED = "RELEASED";

    /** 集成类型：沙箱 */
    private static final String INTEGRATION_TYPE_SANDBOX = "FROM_SANDBOX";

    /** 来源系统：沙箱 */
    private static final String SYS_CODE = "SANDBOX";

    /** 默认自动释放（"1"：自动释放，"0"：不自动释放） */
    private static final Integer AUTO_RELEASE_YES = 0;

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
    private static final long WORKER_READY_TIMEOUT_MS = TimeUnit.MINUTES.toMillis(1);

    /** 等待 Gateway worker 注册完成的轮询间隔（毫秒） */
    private static final long WORKER_READY_POLL_INTERVAL_MS = 100L;

    /** 沙箱空闲超时时间（分钟） */
    @Value("${sandbox.idle.timeout.minutes:5}")
    private int idleTimeoutMinutes;

    /** 沙箱网关令牌 */
    @Value("${sandbox.gateway.token:ztesoft}")
    private String sandboxGatewayToken;

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
        return launchSandboxInternal(userCode, resourceId, sandboxLaunchContextFactory.resolveRouting(resourceId));
    }

    /**
     * 统一的“确保沙箱可用”入口。
     * 登录预启动和会话重试都应通过这里进入，避免在调用侧各自拼接等待逻辑。
     */
    public SandboxLaunchData ensureSandboxReady(String userCode, Long resourceId, String targetAgentType) {
        if (StringUtils.isBlank(targetAgentType)) {
            return launchSandbox(userCode, resourceId);
        }
        SandboxLaunchData launchData = launchSandboxAwait(userCode, resourceId);
        waitWorkerReadySync(targetAgentType);
        return launchData;
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
        String lockKey = SANDBOX_LAUNCH_LOCK_PREFIX + userCode + ":" + routing.getSandboxType() + ":"
            + routing.getEffectiveResourceId();
        String lockValue = UUID.randomUUID().toString();
        boolean locked = false;

        try {
            locked = RedisUtil.lock(lockKey, lockValue, SANDBOX_LAUNCH_LOCK_EXPIRE_SECONDS);
            if (!locked) {
                LOGGER.warn("获取沙箱启动锁失败，用户编码：{}，资源ID：{}，可能并发创建中", userCode, resourceId);
                throw new BdpRuntimeException(I18nUtil.get("sandbox.launch.busy"));
            }

            // 双重检查：在锁内再次查询，防止并发请求重复创建沙箱
            SsSandboxRecord existingRecord = sandboxRecordMapper.selectRunningByUserAndResource(userCode,
                routing.getSandboxType(), routing.getEffectiveResourceId());
            if (existingRecord != null && StringUtils.isNotBlank(existingRecord.getEndpoint())) {
                LOGGER.info("复用已有沙箱，用户编码：{}，资源ID：{}，endpoint：{}", userCode, resourceId, existingRecord.getEndpoint());
                SandboxLaunchData reuseData = new SandboxLaunchData();
                reuseData.setEndpoint(existingRecord.getEndpoint());
                return reuseData;
            }

            return doLaunchSandbox(userCode, resourceId, routing);
        }
        finally {
            if (locked) {
                RedisUtil.releaseLock(lockKey, lockValue);
            }
        }
    }

    /**
     * 启动沙箱并等待就绪。 先查询DB是否已有记录，有则直接轮询endpoint是否就绪； 没有记录则先调用launchSandbox启动，再轮询endpoint是否就绪。
     *
     * @param userCode 用户编码
     * @param resourceId 资源ID，允许为null
     * @return 沙箱启动响应数据
     */
    public SandboxLaunchData launchSandboxAwait(String userCode, Long resourceId) {
        SandboxLaunchRouting routing = sandboxLaunchContextFactory.resolveRouting(resourceId);

        // 1. 查询DB是否已有运行中的沙箱记录
        SsSandboxRecord existingRecord = sandboxRecordMapper.selectRunningByUserAndResource(userCode,
            routing.getSandboxType(), routing.getEffectiveResourceId());
        String endpoint;

        if (existingRecord != null && StringUtils.isNotBlank(existingRecord.getEndpoint())) {
            // 已有记录，直接拿到endpoint
            endpoint = existingRecord.getEndpoint();
            LOGGER.info("等待模式-发现已有沙箱记录，用户编码：{}，资源ID：{}，endpoint：{}", userCode, resourceId, endpoint);
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

    private void waitWorkerReadySync(String targetAgentType) {
        int maxAttempts = (int) (WORKER_READY_TIMEOUT_MS / WORKER_READY_POLL_INTERVAL_MS);
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
                return;
            }
        }
        catch (Throwable e) {
            throw new BdpRuntimeException("等待 Gateway worker 就绪超时: " + targetAgentType, e);
        }

        throw new BdpRuntimeException("等待 Gateway worker 就绪超时: " + targetAgentType);
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
        request.setAutoRelease(AUTO_RELEASE_YES);
        request.setEnvs(launchContext.getEnvs());
        request.setUserInfo(launchContext.getUserInfo());

        LOGGER.info("启动沙箱，用户编码：{}，资源ID：{}，沙箱类型：{}", userCode, resourceId, launchContext.getSandboxType());
        SandboxResponse<SandboxLaunchData> response = sandboxLifecycleFacade.launchSandbox(request);

        if (response == null || !response.isSuccess() || response.getData() == null) {
            String errorMsg = response != null ? response.getMessage() : "响应为空";
            LOGGER.error("启动沙箱失败，用户编码：{}，资源ID：{}，沙箱类型：{}，原因：{}", userCode, resourceId,
                launchContext.getSandboxType(), errorMsg);
            return null;
        }

        SandboxLaunchData launchData = response.getData();
        String endpoint = launchData.getEndpoint();

        endpoint = endpoint + "/chat?token=" + sandboxGatewayToken;
        launchData.setEndpoint(endpoint);

        // 记录沙箱信息到数据库
        SsSandboxRecord record = new SsSandboxRecord();
        record.setResourceId(routing.getEffectiveResourceId());
        record.setUserCode(userCode);
        record.setSandboxType(launchContext.getSandboxType());
        record.setEndpoint(endpoint);
        record.setStatus(STATUS_RUNNING);
        // 默认设置为空闲释放
        record.setAutoRelease(1);
        record.setLastAccessTime(new Date());
        record.setCreateTime(new Date());
        record.setUpdateTime(new Date());
        sandboxRecordMapper.insert(record);

        LOGGER.info("沙箱启动成功，用户编码：{}，资源ID：{}，沙箱类型：{}，endpoint：{}", userCode, resourceId,
            launchContext.getSandboxType(), endpoint);
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
     * 沙箱心跳：更新当前用户指定资源的沙箱最后访问时间 由前端定期轮询调用，防止沙箱因空闲超时被自动回收
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
        try {
            sandboxLifecycleFacade.heartbeat(userCode);
        }
        catch (Exception e) {
            LOGGER.error("心跳保持失败，用户编码：{}", userCode, e);
        }

        SandboxLaunchRouting routing = sandboxLaunchContextFactory.resolveRouting(resourceId);

        SsSandboxRecord record = sandboxRecordMapper.selectRunningByUserAndResource(userCode,
            routing.getSandboxType(), routing.getEffectiveResourceId());
        if (record == null) {
            LOGGER.warn("心跳失败：未找到运行中的沙箱记录，用户编码：{}，沙箱类型：{}，资源ID：{}", userCode,
                routing.getSandboxType(), routing.getEffectiveResourceId());
            return false;
        }
        sandboxRecordMapper.updateLastAccessTime(record.getId(), new Date());
        LOGGER.debug("沙箱心跳成功，用户编码：{}，沙箱类型：{}，资源ID：{}，沙箱记录ID：{}", userCode,
            routing.getSandboxType(), routing.getEffectiveResourceId(), record.getId());
        return true;
    }

    /**
     * 沙箱心跳：更新当前用户指定资源的沙箱最后访问时间 由前端定期轮询调用，防止沙箱因空闲超时被自动回收
     *
     * @param resourceId 资源ID
     * @return true-心跳成功，false-未找到运行中的沙箱
     */
    public boolean heartbeat(String userCode, Long resourceId) {
        if (StringUtils.isBlank(userCode)) {
            LOGGER.warn("心跳失败：无法获取当前用户编码，资源ID：{}", resourceId);
            return false;
        }
        try {
            sandboxLifecycleFacade.heartbeat(userCode);
        }
        catch (Exception e) {
            LOGGER.error("心跳保持失败，用户编码：{}", userCode, e);
        }

        SandboxLaunchRouting routing = sandboxLaunchContextFactory.resolveRouting(resourceId);

        SsSandboxRecord record = sandboxRecordMapper.selectRunningByUserAndResource(userCode,
            routing.getSandboxType(), routing.getEffectiveResourceId());
        if (record == null) {
            LOGGER.warn("心跳失败：未找到运行中的沙箱记录，用户编码：{}，沙箱类型：{}，资源ID：{}", userCode,
                routing.getSandboxType(), routing.getEffectiveResourceId());
            return false;
        }
        sandboxRecordMapper.updateLastAccessTime(record.getId(), new Date());
        LOGGER.debug("沙箱心跳成功，用户编码：{}，沙箱类型：{}，资源ID：{}，沙箱记录ID：{}", userCode,
            routing.getSandboxType(), routing.getEffectiveResourceId(), record.getId());
        return true;
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
        SandboxResponse<List<SandboxInfo>> response = sandboxLifecycleFacade.sandboxInfo(userCode);
        if (response == null || !response.isSuccess()) {
            return null;
        }
        return response.getData();
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
            SandboxLaunchRouting routing = sandboxLaunchContextFactory.resolveRouting(resourceId);
            sandboxType = routing.getSandboxType();
            effectiveResourceIds.add(routing.getEffectiveResourceId());
        }
        List<SsSandboxRecord> records = sandboxRecordMapper.selectRunningByUserAndResources(userCode,
            sandboxType, effectiveResourceIds);
        if (records == null || records.isEmpty()) {
            LOGGER.warn("未找到运行中的沙箱记录，用户编码：{}，资源ID：{}", userCode, resourceId);
            return;
        }
        for (SsSandboxRecord record : records) {
            doRemoveSandbox(record);
        }
    }

    public void updateSandboxById(Long id, Integer autoRelease) {
        SsSandboxRecord record = sandboxRecordMapper.selectById(id);
        if (record == null) {
            throw new BdpRuntimeException("sandbox record not found");
        }
        sandboxRecordMapper.updateAutoRelease(id, autoRelease);
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
            SandboxLaunchRouting routing = sandboxLaunchContextFactory.resolveRouting(resourceId);
            SsSandboxRecord existingRecord = sandboxRecordMapper.selectRunningByUserAndResource(userCode,
                routing.getSandboxType(), routing.getEffectiveResourceId());

            if (existingRecord != null && StringUtils.isNotBlank(existingRecord.getEndpoint())) {
                // 已有运行中的沙箱，替换agentHomeUrl（访问时间由前端心跳接口更新）
                param.put("agentHomeUrl", existingRecord.getEndpoint());
                LOGGER.info("使用已有沙箱，用户编码：{}，资源ID：{}，endpoint：{}", userCode, resourceId, existingRecord.getEndpoint());
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
                .collect(Collectors.toMap(id -> id, sandboxLaunchContextFactory::resolveRouting, (a, b) -> a));
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
                    vo.setAgentHomeUrl(existingRecord.getEndpoint());
                    LOGGER.info("AuthDigitEmployVo-使用已有沙箱，用户编码：{}，资源ID：{}，endpoint：{}", userCode, resourceId,
                        existingRecord.getEndpoint());
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
    public int cleanupExpiredSandboxes() {
        List<SsSandboxRecord> expiredRecords = sandboxRecordMapper.selectExpiredSandboxes(idleTimeoutMinutes);
        if (expiredRecords == null || expiredRecords.isEmpty()) {
            return 0;
        }

        int cleanedCount = 0;
        for (SsSandboxRecord record : expiredRecords) {
            try {
                doRemoveSandbox(record);
                cleanedCount++;
            }
            catch (Exception e) {
                LOGGER.error("清理超时沙箱失败，沙箱记录ID：{}，用户编码：{}，资源ID：{}", record.getId(), record.getUserCode(),
                    record.getResourceId(), e);
            }
        }

        LOGGER.info("清理超时沙箱完成，共清理 {} 个沙箱", cleanedCount);
        return cleanedCount;
    }

    /**
     * 执行沙箱释放操作（远程调用+更新本地记录）
     *
     * @param record 沙箱记录
     */
    private void doRemoveSandbox(SsSandboxRecord record) {
        try {
            LOGGER.info("释放沙箱，ID：{}，用户编码：{}，资源ID：{}", record.getId(), record.getUserCode(), record.getResourceId());
            String lockKey = SANDBOX_LAUNCH_LOCK_PREFIX + record.getUserCode() + ":" + record.getSandboxType() + ":" + record.getResourceId();
            RedisUtil.del(lockKey);
            SandboxLaunchRequest sandboxLaunchRequest = new SandboxLaunchRequest();
            sandboxLaunchRequest.setSandboxType(record.getSandboxType());
            sandboxLaunchRequest.setUserCode(record.getUserCode());
            sandboxLifecycleFacade.removeSandbox(sandboxLaunchRequest);
        }
        catch (Exception e) {
            LOGGER.error("远程释放沙箱失败，沙箱记录ID：{}，用户编码：{}", record.getId(), record.getUserCode(), e);
        }
        // 无论远程调用是否成功，都更新本地记录状态
        sandboxRecordMapper.updateStatusToReleased(record.getId());
        LOGGER.info("沙箱释放完成，记录ID：{}", record.getId());
    }

    private String buildSandboxRecordKey(String sandboxType, Long resourceId) {
        return sandboxType + ":" + resourceId;
    }
}
