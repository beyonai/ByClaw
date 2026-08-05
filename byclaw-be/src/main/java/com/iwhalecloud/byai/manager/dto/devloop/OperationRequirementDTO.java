package com.iwhalecloud.byai.manager.dto.devloop;

import com.fasterxml.jackson.annotation.JsonAlias;
import lombok.Data;

import java.util.Map;

/**
 * 运营需求保存参数。运营需求与研发扫描源共用 byai_scan_source，但通过 source_type 区分业务类型。
 */
@Data
public class OperationRequirementDTO {

    /** 编辑时必填；新增时由后端生成。 */
    private Long itemId;

    /** 所属运营项目。 */
    private Long projectId;

    /** 运营需求名称。 */
    private String requirementName;

    /** 运营目标、范围和交付说明，对应 byai_scan_source.source_description。 */
    @JsonAlias("description")
    private String sourceDescription;

    /** 需求类型：collect-素材采集、publish-内容创作与发布、analyze-数据分析。 */
    private String operationType;

    /** 关联的项目成员用户 ID。 */
    private Long assignee;

    /** 完成时间，前端使用 yyyy-MM-dd HH:mm:ss 提交。 */
    @JsonAlias("due_time")
    private String dueTime;

    /** 三类运营需求的差异化配置，按类型保存为 JSON。 */
    private Map<String, Object> config;
}
