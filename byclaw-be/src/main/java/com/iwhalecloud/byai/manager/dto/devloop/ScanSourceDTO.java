package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

import java.util.List;

@Data
public class ScanSourceDTO {

    private Long sourceId;

    private Long projectId;

    private String sourceName;

    /** 需求或渠道描述；运营需求使用该字段，研发渠道可为空。 */
    private String sourceDescription;

    private String sourceType;

    private String config;

    private String cronExpr;

    private String enabled;

    private Long repoId;

    /** 需求确认规则 manual人工确认/auto全自动派生/score按分数阈值派生 */
    private String confirmMode;

    /** score模式下自动派生的最低综合分 */
    private Integer scoreThreshold;

    /** 运营需求负责人用户 ID。 */
    private Long assignee;

    /** 运营需求完成时间，格式 yyyy-MM-dd HH:mm:ss。 */
    private String dueTime;
}
