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

    /**
     * 总开关（nullable）：
     * <ul>
     *     <li>{@code null}（默认）→ 用户未显式配置，调用方应回退旧 flag {@code INIT_DIG_EMPLOYEE_REDIS_ENABLED}</li>
     *     <li>{@code true} → 显式启用新逻辑（Pipeline + 并行 + 跳过开关）</li>
     *     <li>{@code false} → 显式禁用同步</li>
     * </ul>
     * 此处默认 {@code null}（而非 {@code false}）是为了严格保留与既有
     * {@code INIT_DIG_EMPLOYEE_REDIS_ENABLED} 的行为兼容：未配置新属性的环境
     * 完全保留旧行为。
     */
    private Boolean enabled = null;

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

    /**
     * 返回{@link #enabled}的原始配置值，可为 {@code null}（未显式配置）。
     * <p>
     * 调用方在判定"是否走新路径"时必须使用此方法：
     * <ul>
     *     <li>{@code null} → 走旧路径（Runner 回退到 {@code INIT_DIG_EMPLOYEE_REDIS_ENABLED} 旧 flag）</li>
     *     <li>{@code Boolean.TRUE.equals(getEnabledRaw())} → 走新路径</li>
     *     <li>{@code Boolean.FALSE.equals(getEnabledRaw())} → 显式禁用</li>
     * </ul>
     */
    public Boolean getEnabledRaw() {
        return enabled;
    }

    /**
     * 等价于 {@code Boolean.TRUE.equals(enabled)}；用于兼容既有用法。
     */
    public boolean isEnabled() {
        return Boolean.TRUE.equals(this.enabled);
    }

    /**
     * Spring Boot 配置绑定 setter；接受 {@code null} 以表示"未配置"。
     */
    public void setEnabled(Boolean enabled) {
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
