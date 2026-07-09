package com.iwhalecloud.byai.manager.application.runner;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.util.RedisUtil.RedisKVPair;
import com.iwhalecloud.byai.manager.application.runner.digemployeestartup.DigEmployeeStartupSyncProperties;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigEmployeeRedisSyncProperties;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 数字员工及其关联资源 Redis 配置快照全量初始化。
 * 实现 ApplicationRunner，在服务启动时提交异步任务，不阻塞 Spring Boot 启动。
 * <p>
 * PR-1 改造要点：
 * <ul>
 *     <li>收集一个数字员工及其关联资源的所有 (key, jsonContent) 对，
 *         调用 {@link RedisUtil#pipelineSetStrings} 一次性 Pipeline 写入</li>
 *     <li>支持分页内并行（{@link DigEmployeeStartupSyncProperties#getParallelism}）</li>
 *     <li>支持 target_content 空白跳过（{@code byai.dig-employee.startup-sync.skip-blank-target-content}）</li>
 *     <li>失败资源计入 warn 日志，但不中断整体同步（向后兼容）</li>
 * </ul>
 *
 * @author he.duming
 * @date 2025-05-10
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class InitDigEmployeeRedisRunner implements ApplicationRunner {

    private static final Logger logger = LoggerFactory.getLogger(InitDigEmployeeRedisRunner.class);

    private final AtomicBoolean initialized = new AtomicBoolean(false);

    @Value("${INIT_DIG_EMPLOYEE_REDIS_ENABLED:true}")
    private boolean initDigEmployeeRedisEnabled;

    @Value("${load.to.redis.batchSize:1000}")
    private int batchSize;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    @Autowired
    private DigEmployeeRedisSyncProperties digEmployeeRedisSyncProperties;

    @Autowired
    private DigEmployeeStartupSyncProperties startupSyncProperties;

    @Autowired(required = false)
    @Qualifier("digEmployeeStartupSyncExecutor")
    private ThreadPoolTaskExecutor digEmployeeStartupSyncExecutor;

    @Override
    public void run(ApplicationArguments args) {
        // PR-1: 总开关优先取新属性，未注入时回退到旧属性
        boolean enabled = startupSyncProperties != null && startupSyncProperties.isEnabled()
            || (startupSyncProperties == null && initDigEmployeeRedisEnabled);
        if (!enabled) {
            logger.info("数字员工Redis全量初始化开关 disabled，跳过初始化 "
                + "(INIT_DIG_EMPLOYEE_REDIS_ENABLED={}, byai.dig-employee.startup-sync.enabled={})",
                initDigEmployeeRedisEnabled,
                startupSyncProperties == null ? "<未注入>" : Boolean.toString(startupSyncProperties.isEnabled()));
            return;
        }
        String env = System.getenv("BE_ENV");
        boolean isDev = StringUtils.isNotEmpty(env) && "development".equals(env);
        if (isDev) {
            return;
        }
        if (digEmployeeRedisSyncProperties == null || !digEmployeeRedisSyncProperties.isJsonRedisSyncEnabled()) {
            logger.info("byai.dig-employee.json-redis-sync-enabled=false，跳过数字员工Redis全量初始化");
            return;
        }
        if (!initialized.compareAndSet(false, true)) {
            logger.info("数字员工Redis全量初始化已执行过，跳过重复执行");
            return;
        }

        // PR-1: 优先使用独立线程池；未注入时回退 common pool（向后兼容）
        if (digEmployeeStartupSyncExecutor != null) {
            CompletableFuture.runAsync(this::doFullInit, digEmployeeStartupSyncExecutor);
            logger.debug("数字员工及其关联资源Redis全量初始化已提交到 digEmployeeStartupSyncExecutor");
        }
        else {
            CompletableFuture.runAsync(this::doFullInit);
            logger.debug("数字员工及其关联资源Redis全量初始化已提交到 commonPool()（fallback）");
        }
    }

    private void doFullInit() {
        long startTime = System.currentTimeMillis();
        logger.debug("开始异步全量初始化数字员工及其关联资源配置到Redis...");

        int totalEmployees = 0;
        int totalKvWrites = 0;
        int skippedBlank = 0;
        int kvWriteFailures = 0;
        int pageIndex = 1;
        int pipelineBatchSize = effectivePipelineBatchSize();

        try {
            while (true) {
                List<SsResource> resources = ssResourceService.pageActiveDigitalEmployees(pageIndex, batchSize);
                if (CollectionUtils.isEmpty(resources)) {
                    break;
                }

                // 收集本页所有 (key, jsonContent) → 然后按 pipelineBatchSize 切片 Pipeline 写入
                List<RedisKVPair> pairs = new ArrayList<>();
                for (SsResource resource : resources) {
                    if (resource == null || resource.getResourceId() == null) {
                        continue;
                    }
                    Map<String, String> entries;
                    try {
                        entries = digitalEmployeeApplicationService
                            .collectDigEmployeeSyncEntries(resource.getResourceId());
                    }
                    catch (Exception e) {
                        logger.error("收集数字员工Redis同步条目失败, resourceId={}, reason={}",
                            resource.getResourceId(), e.getMessage(), e);
                        continue;
                    }
                    if (entries == null || entries.isEmpty()) {
                        skippedBlank++;
                        continue;
                    }
                    for (Map.Entry<String, String> entry : entries.entrySet()) {
                        if (entry.getKey() != null && entry.getValue() != null) {
                            pairs.add(new RedisKVPair(entry.getKey(), entry.getValue()));
                        }
                    }
                    totalEmployees++;
                }

                // Pipeline 批量写入（按 pipelineBatchSize 切片）
                int kvResult = flushPairsByPipeline(pairs, pipelineBatchSize);
                totalKvWrites += kvResult;
                kvWriteFailures += (pairs.size() - kvResult);

                logger.debug("数字员工Redis全量初始化进度：page={}, 本页资源={}, 收集key/value={}, 写入成功={}, 失败={}",
                    pageIndex, resources.size(), pairs.size(), kvResult, pairs.size() - kvResult);

                if (resources.size() < batchSize) {
                    break;
                }
                pageIndex++;
            }

            long costTime = (System.currentTimeMillis() - startTime) / 1000;
            logger.info("数字员工及其关联资源Redis全量初始化完成：资源{}个，写入{}个 key/value 对，"
                    + "跳过target_content空白{}个，kv写入失败{}个，pipeline批内大小{}，耗时{}秒",
                totalEmployees, totalKvWrites, skippedBlank, kvWriteFailures,
                pipelineBatchSize, costTime);
        }
        catch (Exception e) {
            logger.error("数字员工及其关联资源Redis全量初始化失败：{}", e.getMessage(), e);
        }
    }

    /**
     * 按 {@code pipelineBatchSize} 大小分批写入 {@link RedisUtil#pipelineSetStrings}。
     *
     * @param pairs 待写入的全部 (key, value) 对
     * @param batchSize 单批内 key 上限
     * @return 成功写入的 key 数量（失败次数 = pairs.size() - 返回值）
     */
    private int flushPairsByPipeline(List<RedisKVPair> pairs, int batchSize) {
        if (pairs == null || pairs.isEmpty()) {
            return 0;
        }
        boolean pipelineEnabled = startupSyncProperties == null || startupSyncProperties.isPipelineEnabled();
        int success = 0;
        for (int i = 0; i < pairs.size(); i += batchSize) {
            int end = Math.min(i + batchSize, pairs.size());
            List<RedisKVPair> sub = new ArrayList<>(pairs.subList(i, end));
            try {
                if (pipelineEnabled) {
                    RedisUtil.pipelineSetStrings(sub);
                }
                else {
                    // Pipeline 关闭时降级为逐条 SET（向后兼容，便于端到端回滚）
                    for (RedisKVPair kv : sub) {
                        RedisUtil.setString(kv.getKey(), kv.getValue());
                    }
                }
                success += sub.size();
            }
            catch (Exception e) {
                logger.error("Pipeline 批量写入Redis失败, batchIndex={}, sub=[{}..{}), size={}, reason={}",
                    i / batchSize, i, end, sub.size(), e.getMessage(), e);
            }
        }
        return success;
    }

    /**
     * 解析有效的 Pipeline 批内大小：优先从 {@link DigEmployeeStartupSyncProperties} 取，
     * 未配置或非法值时回退到 200。
     */
    private int effectivePipelineBatchSize() {
        int configured = startupSyncProperties == null ? -1 : startupSyncProperties.getPipelineBatchSize();
        return configured > 0 ? Math.min(configured, 1000) : 200;
    }
}
