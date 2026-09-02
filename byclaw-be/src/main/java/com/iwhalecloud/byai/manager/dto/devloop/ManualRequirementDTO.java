package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/**
 * 不经过外部扫描渠道的手工需求请求参数。
 * 持久化字段不依赖语言，展示名称由服务层按当前请求语言解析。
 */
@Data
public class ManualRequirementDTO {

    /** 归属项目，同时决定复用哪个项目级内部手工来源。 */
    private Long projectId;

    /** 稳定的来源标识：manual、customer_feedback 或 internal_proposal。 */
    private String sourceType;

    /** 可选的受影响分支上下文，仅用于描述需求，不能替代创建任务时生成的目标分支。 */
    private String branch;

    /** 可选的关联项目仓库 ID；仅归属当前需求，不能写入项目共用的内部手工来源。 */
    private Long repoId;

    /**
     * 可选的外部稳定标识（钉钉 taskId、GitHub issue 号等）。
     * 采集重复执行时用它命中同一条需求并原样返回，避免同一诉求刷出多行；
     * 为空则生成一次性 UUID，等同于每次都是新需求。
     */
    private String originId;

    /** 必填的需求标题，后续复用为任务初始标题。 */
    private String title;

    /** 必填的提交者原始需求文本。 */
    private String originalContent;

    /** 可选的产品层上下文，与原始需求一并保存。 */
    private String productContent;
}
