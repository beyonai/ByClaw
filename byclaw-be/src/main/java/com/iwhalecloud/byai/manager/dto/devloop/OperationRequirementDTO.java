package com.iwhalecloud.byai.manager.dto.devloop;

import com.fasterxml.jackson.annotation.JsonAlias;
import lombok.Data;

import java.util.Map;

/**
 * 运营需求保存参数。
 * 运营需求独立存储，不复用研发扫描需求表，避免运营字段影响钉钉和 GitHub 的扫描链路。
 */
@Data
public class OperationRequirementDTO {

    /** 编辑时必填；新增时由后端生成。 */
    private Long itemId;

    /** 所属运营项目。 */
    private Long projectId;

    /** 运营需求名称。 */
    private String requirementName;

    /** 运营目标、范围和交付说明。 */
    private String description;

    /** 需求类型：collect-素材采集、publish-内容创作与发布、analyze-数据分析。 */
    private String operationType;

    /** 关联的项目成员用户 ID。 */
    private Long assignee;

    /** 完成时间，前端使用 yyyy-MM-dd HH:mm:ss 提交。 */
    @JsonAlias("due_time")
    private String dueTime;

    /** 需求状态：todo、launched、doing、pendingReview、done、cancelled。 */
    private String status;

    /** 当前进度，范围为 0 到 100。 */
    private Integer progress;

    /** 三类运营需求的差异化配置，按类型保存为 JSON。 */
    private Map<String, Object> config;
}
