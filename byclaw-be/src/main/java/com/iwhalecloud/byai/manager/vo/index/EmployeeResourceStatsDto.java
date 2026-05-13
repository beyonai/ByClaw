package com.iwhalecloud.byai.manager.vo.index;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 数字员工资源统计DTO
 * 统计知识和技能数量
 *
 * @author system
 * @date 2025-01-19
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EmployeeResourceStatsDto {

    /**
     * 数字员工资源ID
     */
    private Long employeeId;

    /**
     * 知识数量总和 (KG_DOC + KG_QA + KG_TERM)
     */
    private Integer knowledgeCount;

    /**
     * 技能数量总和 (AGENT + MCP + TOOLKIT + TOOL)
     */
    private Integer skillsCount;

    /**
     * 详细统计信息
     */
    private ResourceTypeCount detailStats;
}
