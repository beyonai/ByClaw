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
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 数字员工及其关联资源 Redis 配置快照全量初始化。
 * 实现 ApplicationRunner，在服务启动时提交异步任务，不阻塞 Spring Boot 启动。
 * <p>
 * <strong>PR-1 改造要点</strong>：
 * <ul>
 *     <li>收集一个数字员工及其关联资源的所有 (key, jsonContent) 对，
 *         调用 {@link RedisUtil#pipelineSetStrings} 一次性 Pipeline 写入</li>
 *     <li>支持分页内并行（{@link DigEmployeeStartupSyncProperties#getParallelism}）</li>
 *     <li>支持 target_content 空白跳过（{@code byai.dig-employee.startup-sync.skip-blank-target-content}）</li>
 *     <li>失败资源计入 warn 日志，但不中断整体同步（向后兼容）</li>
 * </ul>
 *
 * <strong>PR-fix Major-3/4/5 改造要点</strong>（向后兼容）：
 * <ul>
 *     <li>新路径仅在显式配置 {@code byai.dig-employee.startup-sync.enabled=true} 时启用</li>
 *     <li>未配置新属性（默认 null）→ 回退旧 flag {@code INIT_DIG_EMPLOYEE_REDIS_ENABLED} 行为</li>
 *     <li>分页内并行：每页拆 {@code parallelism} 个 chunk，各自走独立 Pipeline</li>
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

    /**
     * PR-1 启动期同步优化属性。{@code DigEmployeeStartupSyncProperties.enabled} 默认为 {@code null}
     * （未显式配置）；调用方需通过 {@link DigEmployeeStartupSyncProperties#getEnabledRaw()}
     * 区分"未配置 vs 显式 false"。
     */
    @Autowired
    private DigEmployeeStartupSyncProperties startupSyncProperties;

    /**
     * 分页内并行专用线程池（PR-1 引入）；可选注入，
     * 未注入时分片任务回退 {@link ForkJoinPool#commonPool()}。
     */
    @Autowired(required = false)
    @Qualifier("digEmployeeStartupSyncExecutor")
    private ThreadPoolTaskExecutor digEmployeeStartupSyncExecutor;

    @Override
    public void run(ApplicationArguments args) {
        String env = System.getenv("BE_ENV");
        boolean isDev = StringUtils.isNotEmpty(env) && "development".equals(env);
        if (isDev) {
            logger.info("BE_ENV=development 跳过数字员工Redis全量初始化");
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

        // PR-fix Major-5: 双开关显式 if/else 合并
        boolean newPropsExplicitlyConfigured = startupSyncProperties != null
            && startupSyncProperties.getEnabledRaw() != null;
        boolean newEnabledValue = startupSyncProperties != null && startupSyncProperties.isEnabled();
        boolean legacyEnabled = initDigEmployeeRedisEnabled;

        boolean runAnyPath;
        if (newPropsExplicitlyConfigured) {
            // 显式配置新属性时，新属性为唯一权威
            runAnyPath = newEnabledValue;
            if (runAnyPath) {
                logger.info("byai.dig-employee.startup-sync.enabled=true 显式启用新路径（Pipeline + 分页内并行 + 跳过开关）");
            }
            else {
                logger.info("byai.dig-employee.startup-sync.enabled=false 显式禁用同步；忽略旧 env INIT_DIG_EMPLOYEE_REDIS_ENABLED={}",
                    legacyEnabled);
                return;
            }
        }
        else {
            // 未配置新属性 → 严格向后兼容旧 flag
            runAnyPath = legacyEnabled;
            logger.info("byai.dig-employee.startup-sync 未显式配置，回退旧 flag INIT_DIG_EMPLOYEE_REDIS_ENABLED={}",
                legacyEnabled);
            if (!runAnyPath) {
                return;
            }
        }

        // 顶层异步任务使用 commonPool（避免与内部分片并行任务争用独立 Executor）
        CompletableFuture.runAsync(this::doFullInit);
        logger.debug("数字员工及其关联资源Redis全量初始化已提交异步执行");
    }

    /**
     * 主入口：检测是否走优化路径（Pipeline + 分页内并行 + 跳过开关），
     * 其余情况走兼容旧行为（{@link #doFullInitLegacy()}）。
     */
    private void doFullInit() {
        long startTime = System.currentTimeMillis();
        logger.debug("开始异步全量初始化数字员工及其关联资源配置到Redis...");

        // 仅在新属性显式配置为 true 时走优化路径
        boolean optimizedPath = startupSyncProperties != null
            && Boolean.TRUE.equals(startupSyncProperties.getEnabledRaw())
            && startupSyncProperties.isEnabled();

        try {
            if (optimizedPath) {
                doFullInitOptimized();
            }
            else {
                doFullInitLegacy();
            }
        }
        catch (Exception e) {
            logger.error("数字员工及其关联资源Redis全量初始化失败：{}", e.getMessage(), e);
        }

        long costTime = (System.currentTimeMillis() - startTime) / 1000;
        logger.info("数字员工及其关联资源Redis全量初始化完成，耗时{}秒", costTime);
    }

    /**
     * 优化路径（PR-1）。每页拆 parallelism 个 chunk，每个 chunk 独立 Pipeline 写入；
     * chunk 失败不影响其他 chunk；与 PR-#2/3/4 无关，本函数仅实现 PR-1 范围。
     */
    private void doFullInitOptimized() {
        int pipelineBatchSize = effectivePipelineBatchSize();
        int parallelism = effectiveParallelism();
        ExecutorService exec = digEmployeeStartupSyncExecutor != null
            ? digEmployeeStartupSyncExecutor.getThreadPoolExecutor()
            : ForkJoinPool.commonPool();

        int totalEmployees = 0;
        int totalKvWrites = 0;
        int totalKvFailures = 0;
        int totalSkippedBlank = 0;
        int pageIndex = 1;

        while (true) {
            List<SsResource> resources = ssResourceService.pageActiveDigitalEmployees(pageIndex, batchSize);
            if (CollectionUtils.isEmpty(resources)) {
                break;
            }

            // 1) split page into chunks
            List<List<SsResource>> chunks = chunkSplit(resources, parallelism);
            // 2) submit each chunk in parallel
            List<CompletableFuture<ChunkStats>> futures = new ArrayList<>(chunks.size());
            for (List<SsResource> chunk : chunks) {
                futures.add(CompletableFuture.supplyAsync(
                    () -> processChunk(chunk, pipelineBatchSize),
                    exec));
            }
            // 3) wait all
            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
            // 4) aggregate
            for (CompletableFuture<ChunkStats> f : futures) {
                ChunkStats st = f.getNow(ChunkStats.empty());
                totalEmployees += st.total;
                totalKvWrites += st.kvWrites;
                totalKvFailures += st.kvFailures;
                totalSkippedBlank += st.skippedBlank;
            }

            logger.debug("数字员工Redis全量初始化进度：page={}, 本页资源={}, chunks={}, "
                    + "本批写入成功={}, 失败={}, 跳过target_content空白={}",
                pageIndex, resources.size(), chunks.size(),
                futures.stream().mapToInt(f -> f.getNow(ChunkStats.empty()).kvWrites).sum(),
                futures.stream().mapToInt(f -> f.getNow(ChunkStats.empty()).kvFailures).sum(),
                futures.stream().mapToInt(f -> f.getNow(ChunkStats.empty()).skippedBlank).sum());

            if (resources.size() < batchSize) {
                break;
            }
            pageIndex++;
        }

        logger.info("数字员工及其关联资源Redis全量初始化（优化路径）完成：资源{}个，写入{}个 key/value 对，"
                + "kv失败{}个，跳过target_content空白{}个，分片并行度={}，pipeline批内大小={}",
            totalEmployees, totalKvWrites, totalKvFailures, totalSkippedBlank,
            parallelism, pipelineBatchSize);
    }

    /**
     * 兼容路径：保留 PR-1 之前的原始行为（单条 Redis SET + 关联资源单条 SET），
     * 通过 {@code syncExistingDigEmployeeConfigToRedisQuietly} 单条写入，
     * 适配无法立刻切到 Pipeline 的环境。
     */
    private void doFullInitLegacy() {
        int totalEmployees = 0;
        int pageIndex = 1;

        try {
            while (true) {
                List<SsResource> resources = ssResourceService.pageActiveDigitalEmployees(pageIndex, batchSize);
                if (CollectionUtils.isEmpty(resources)) {
                    break;
                }
                for (SsResource resource : resources) {
                    if (resource == null || resource.getResourceId() == null) {
                        continue;
                    }
                    try {
                        digitalEmployeeApplicationService
                            .syncExistingDigEmployeeConfigToRedisQuietly(resource.getResourceId());
                        totalEmployees++;
                    }
                    catch (Exception e) {
                        logger.error("全量同步数字员工Redis失败, resourceId={}, reason={}",
                            resource.getResourceId(), e.getMessage(), e);
                    }
                }
                logger.debug("数字员工Redis全量初始化（legacy）进度：已处理{}个数字员工", totalEmployees);
                if (resources.size() < batchSize) {
                    break;
                }
                pageIndex++;
            }
            logger.info("数字员工及其关联资源Redis全量初始化（legacy 路径）完成：共处理{}个数字员工", totalEmployees);
        }
        catch (Exception e) {
            logger.error("数字员工及其关联资源Redis全量初始化（legacy）失败：{}", e.getMessage(), e);
        }
    }

    /**
     * 处理一个 chunk：遍历资源 → 收集 (key, jsonContent) → Pipeline 批量写入。
     * <p>
     * 单 chunk 失败（collect 异常 / Pipeline 异常）被 try/catch 隔离，记录日志后返回；
     * 不影响其他 chunk 的执行。
     */
    private ChunkStats processChunk(List<SsResource> chunk, int pipelineBatchSize) {
        int total = 0;
        int kvWrites = 0;
        int kvFailures = 0;
        int skippedBlank = 0;
        List<RedisKVPair> pairs = new ArrayList<>();
        try {
            for (SsResource resource : chunk) {
                if (resource == null || resource.getResourceId() == null) {
                    continue;
                }
                total++;
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
            }
            int writes = flushPairsByPipeline(pairs, pipelineBatchSize);
            kvWrites += writes;
            kvFailures += (pairs.size() - writes);
        }
        catch (Exception e) {
            logger.error("chunk 处理异常, chunkSize={}, reason={}", chunk.size(), e.getMessage(), e);
        }
        return new ChunkStats(total, kvWrites, kvFailures, skippedBlank);
    }

    /**
     * 将一页资源按 parallelism 拆分；当 parallelism &lt;= 1 或资源数不足时不拆分。
     * 尽量做到余数均匀分布（前几个 chunk 多 1 条）。
     */
    static List<List<SsResource>> chunkSplit(List<SsResource> resources, int parallelism) {
        if (resources == null || resources.isEmpty()) {
            return Collections.emptyList();
        }
        if (parallelism <= 1 || resources.size() <= parallelism) {
            return Collections.singletonList(new ArrayList<>(resources));
        }
        int nchunks = Math.min(parallelism, resources.size());
        int baseSize = resources.size() / nchunks;
        int remainder = resources.size() % nchunks;
        List<List<SsResource>> chunks = new ArrayList<>(nchunks);
        int idx = 0;
        for (int i = 0; i < nchunks; i++) {
            int sz = baseSize + (i < remainder ? 1 : 0);
            chunks.add(new ArrayList<>(resources.subList(idx, idx + sz)));
            idx += sz;
        }
        return chunks;
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

    /**
     * 解析有效分片并行度：上限 8、下限 1；未配置时回退到 1（保持向后兼容串行语义）。
     */
    private int effectiveParallelism() {
        int configured = startupSyncProperties == null ? -1 : startupSyncProperties.getParallelism();
        if (configured <= 0) {
            return 1;
        }
        return Math.max(1, Math.min(configured, 8));
    }

    /**
     * 单 chunk 处理结果统计。
     */
    static final class ChunkStats {
        final int total;
        final int kvWrites;
        final int kvFailures;
        final int skippedBlank;

        ChunkStats(int total, int kvWrites, int kvFailures, int skippedBlank) {
            this.total = total;
            this.kvWrites = kvWrites;
            this.kvFailures = kvFailures;
            this.skippedBlank = skippedBlank;
        }

        static ChunkStats empty() {
            return new ChunkStats(0, 0, 0, 0);
        }
    }
}
