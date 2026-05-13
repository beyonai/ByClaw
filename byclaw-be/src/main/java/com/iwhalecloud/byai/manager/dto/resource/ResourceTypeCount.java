package com.iwhalecloud.byai.manager.dto.resource;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 资源类型统计详情
 *
 * @author system
 * @date 2025-01-19
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResourceTypeCount {

    /**
     * 文档知识库数量
     */
    private Integer kgDocCount;

    /**
     * 问答知识库数量
     */
    private Integer kgQaCount;

    /**
     * 术语知识库数量
     */
    private Integer kgTermCount;

    /**
     * 智能体数量
     */
    private Integer agentCount;

    /**
     * MCP服务数量
     */
    private Integer mcpCount;

    /**
     * 工具集数量
     */
    private Integer toolkitCount;

    /**
     * 工具数量
     */
    private Integer toolCount;

    /**
     * 对象数量
     */
    private Integer objectCount;

    /**
     * 视图数量
     */
    private Integer viewCount;

    /**
     * 获取知识总数
     */
    public Integer getTotalKnowledge() {
        return (kgDocCount != null ? kgDocCount : 0) +
               (kgQaCount != null ? kgQaCount : 0) +
               (kgTermCount != null ? kgTermCount : 0);
    }

    /**
     * 获取技能总数
     */
    public Integer getTotalSkills() {
        return (agentCount != null ? agentCount : 0) +
               (mcpCount != null ? mcpCount : 0) +
               (toolkitCount != null ? toolkitCount : 0) +
               (toolCount != null ? toolCount : 0) +
               (objectCount != null ? objectCount : 0) +
               (viewCount != null ? viewCount : 0);
    }
}
