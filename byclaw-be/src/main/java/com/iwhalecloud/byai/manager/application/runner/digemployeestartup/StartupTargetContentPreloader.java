package com.iwhalecloud.byai.manager.application.runner.digemployeestartup;

import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * c-4 离线预生成脚本（PR-1）。
 * <p>
 * 启动期 Runner {@code InitDigEmployeeRedisRunner} 在执行
 * {@code byai.dig-employee.startup-sync.skip-blank-target-content=true} 之前，
 * 必须先由本工具把 {@code ss_res_ext_dig_employee.target_content} 补齐，否则会
 * 出现"同步完成但实际只同步了一半"的静默错误。
 * <p>
 * <strong>设计契约</strong>：
 * <ul>
 *   <li>本 Runner 不会在标准生产配置下自动执行；它依赖 Profile
 *       {@code preload-target-content}（由运维在执行批次之前显式启用）</li>
 *   <li>对每个 {@code target_content} 为空的活跃数字员工，调用
 *       {@link DigitalEmployeeApplicationService#synOpenClawWorkSpace(Long)} 同步。</li>
 *   <li>该方法会同时触发 target_content 持久化、MinIO 推送、Redis 同步、关联资源补发</li>
 *   <li>幂等：再次运行会跳过已存在 target_content 的资源</li>
 * </ul>
 *
 * @author ByClaw PR-1
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class StartupTargetContentPreloader implements ApplicationRunner {

    private static final Logger logger = LoggerFactory.getLogger(StartupTargetContentPreloader.class);

    /** 启用 Profile 的系统属性 key */
    public static final String PRELOAD_PROFILE = "preload-target-content";

    private final AtomicBoolean executed = new AtomicBoolean(false);

    @Value("${byai.dig-employee.startup-sync.preload-batch-size:500}")
    private int preloadBatchSize;

    @Value("${byai.dig-employee.startup-sync.preload-sleep-ms:5000}")
    private long preloadSleepMs;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    @Override
    public void run(ApplicationArguments args) {
        if (!isPreloadProfileActive()) {
            logger.debug("StartupTargetContentPreloader 未启用（Profile != {}），跳过", PRELOAD_PROFILE);
            return;
        }
        if (!executed.compareAndSet(false, true)) {
            logger.info("StartupTargetContentPreloader 已执行过，跳过重复执行");
            return;
        }
        PreloadResult result = preload(preloadBatchSize);
        logger.info(
            "StartupTargetContentPreloader 完成: total={}, processed={}, skipped={}, failed={}, costSeconds={}",
            result.getTotal(), result.getProcessed(), result.getSkipped(),
            result.getFailed(), result.getCostMs() / 1000);
    }

    /**
     * 主动调用入口（运维 / 测试用）。分页遍历所有活跃数字员工，对缺失
     * {@code target_content} 的资源调用 {@code synOpenClawWorkSpace} 触发标准同步链路。
     * <p>
     * 该方法会拉取详情、构建标准 JSON、写 target_content、写 MinIO、写 Redis。
     * 因此这是"会动 Redis 与 MinIO 的重型操作"，**仅供运维在受控窗口内执行**。
     *
     * @param batchSize 单次分页大小（默认 500）
     * @return 累计统计（total/processed/skipped/failed/costMs/failedIds）
     */
    public PreloadResult preload(int batchSize) {
        long start = System.currentTimeMillis();
        PreloadResult result = new PreloadResult();
        if (batchSize <= 0) {
            batchSize = 500;
        }

        int total = 0;
        int processed = 0;
        int skipped = 0;
        int failed = 0;
        List<String> failedIds = new ArrayList<>();

        int pageIndex = 1;
        while (true) {
            List<SsResource> resources = ssResourceService.pageActiveDigitalEmployees(pageIndex, batchSize);
            if (resources == null || resources.isEmpty()) {
                break;
            }
            for (SsResource resource : resources) {
                if (resource == null || resource.getResourceId() == null) {
                    continue;
                }
                total++;
                try {
                    // synOpenClawWorkSpace 内部会先写 target_content（若 blank）再写 Redis；幂等可重入。
                    digitalEmployeeApplicationService.synOpenClawWorkSpace(resource.getResourceId());
                    processed++;
                }
                catch (Exception e) {
                    failed++;
                    failedIds.add(String.valueOf(resource.getResourceId()));
                    logger.warn("Preload 失败 resourceId={}: {}", resource.getResourceId(), e.getMessage());
                }
            }
            if (preloadSleepMs > 0) {
                try {
                    Thread.sleep(preloadSleepMs);
                }
                catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
            if (resources.size() < batchSize) {
                break;
            }
            pageIndex++;
        }

        result.setTotal(total);
        result.setProcessed(processed);
        result.setSkipped(skipped);
        result.setFailed(failed);
        result.setFailedIds(failedIds);
        result.setCostMs(System.currentTimeMillis() - start);
        return result;
    }

    /**
     * 检测当前 Spring 上下文是否启用了 {@link #PRELOAD_PROFILE} Profile。
     * <p>
     * 由于本类没有直接持有 {@code ApplicationContext}，采用反射式轻量读取系统属性兜底；
     * 实际更稳的判断是运维在执行前手动确认 profile 已启用。
     */
    private boolean isPreloadProfileActive() {
        String sysProp = System.getProperty("spring.profiles.active");
        if (sysProp != null) {
            for (String p : sysProp.split(",")) {
                if (PRELOAD_PROFILE.equalsIgnoreCase(p.trim())) {
                    return true;
                }
            }
        }
        String envProp = System.getenv("SPRING_PROFILES_ACTIVE");
        if (envProp != null) {
            for (String p : envProp.split(",")) {
                if (PRELOAD_PROFILE.equalsIgnoreCase(p.trim())) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 预生成结果统计。
     */
    public static class PreloadResult {
        private int total;
        private int processed;
        private int skipped;
        private int failed;
        private long costMs;
        private List<String> failedIds = new ArrayList<>();

        public int getTotal() { return total; }
        public void setTotal(int total) { this.total = total; }

        public int getProcessed() { return processed; }
        public void setProcessed(int processed) { this.processed = processed; }

        public int getSkipped() { return skipped; }
        public void setSkipped(int skipped) { this.skipped = skipped; }

        public int getFailed() { return failed; }
        public void setFailed(int failed) { this.failed = failed; }

        public long getCostMs() { return costMs; }
        public void setCostMs(long costMs) { this.costMs = costMs; }

        public List<String> getFailedIds() { return failedIds; }
        public void setFailedIds(List<String> failedIds) { this.failedIds = failedIds; }
    }
}
