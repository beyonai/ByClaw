package com.iwhalecloud.byai.manager.application.runner.digemployeestartup;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 数字员工 Redis 启动期全量同步优化配置（PR-1）。
 * <p>
 * 配置前缀：{@code byai.dig-employee.startup-sync}
 *
 * <p>字段说明：
 * <ul>
 *     <li>{@link #enabled} — 总开关；与既有 {@code INIT_DIG_EMPLOYEE_REDIS_ENABLED} 等价，PR-1 起统一收敛到此属性</li>
 *     <li>{@link #pipelineEnabled} — 是否启用 Redis Pipeline（默认 true）</li>
 *     <li>{@link #pipelineBatchSize} — Pipeline 单批内 key 数（默认 200）</li>
 *     <li>{@link #parallelism} — 分页内并行子任务数（默认 4）</li>
 *     <li>{@link #skipBlankTargetContent} — target_content 空白时是否跳过该资源（默认 false，保持向后兼容）</li>
 * </ul>
 *
 * <p>注册方式：在 {@code DigEmployeeChangeConfiguration} 中通过 {@code @EnableConfigurationProperties} 注册。
 */
@ConfigurationProperties(prefix = "byai.dig-employee.startup-sync")
public class DigEmployeeStartupSyncProperties {

    /** 总开关 */
    private boolean enabled = true;

    /** 是否启用 Redis Pipeline 批量写入 */
    private boolean pipelineEnabled = true;

    /** Pipeline 单批内 key 数 */
    private int pipelineBatchSize = 200;

    /** 分页内并行子任务数 */
    private int parallelism = 4;

    /**
     * target_content 空白时是否跳过该资源（不调用 findDetailsById 回退查询）。
     * 默认 false，保持原有行为（回退到 findDetailsById）。
     * <p>
     * 若开启，强烈建议先执行 {@link StartupTargetContentPreloader#preload(int)} ，
     * 并确认指标 {@code byai_digemployee_startup_sync_blank_target_content_rate < 0.001}。
     */
    private boolean skipBlankTargetContent = false;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean isPipelineEnabled() {
        return pipelineEnabled;
    }

    public void setPipelineEnabled(boolean pipelineEnabled) {
        this.pipelineEnabled = pipelineEnabled;
    }

    public int getPipelineBatchSize() {
        return pipelineBatchSize;
    }

    public void setPipelineBatchSize(int pipelineBatchSize) {
        this.pipelineBatchSize = pipelineBatchSize;
    }

    public int getParallelism() {
        return parallelism;
    }

    public void setParallelism(int parallelism) {
        this.parallelism = parallelism;
    }

    public boolean isSkipBlankTargetContent() {
        return skipBlankTargetContent;
    }

    public void setSkipBlankTargetContent(boolean skipBlankTargetContent) {
        this.skipBlankTargetContent = skipBlankTargetContent;
    }
}
