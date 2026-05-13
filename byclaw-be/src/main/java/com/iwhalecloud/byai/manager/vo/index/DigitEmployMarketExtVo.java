package com.iwhalecloud.byai.manager.vo.index;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-11-13 10:40:44
 * @description 仅用于封装查询，JSON不返回此字段给前端
 */
@Getter
@Setter
public class DigitEmployMarketExtVo extends DigitEmployMarketVo {

    /**
     * 红名单授权数量
     */
    @JsonIgnore
    private Long redCount = 0L;

    /**
     * 黑名单授权数量
     */
    @JsonIgnore
    private Long blackCount = 0L;

    /**
     * 强制授权数量
     */
    @JsonIgnore
    private Long forceUseCount = 0L;

    /**
     * 可用授权数量
     */
    @JsonIgnore
    private Long availableUseCount = 0L;

    /**
     * 审核中授权数量
     */
    @JsonIgnore
    private Long approveStatusCount = 0L;

    /**
     * 知识数量总和 (KG_DOC + KG_QA + KG_TERM)
     */
    private Integer knowledgeCount;

    /**
     * 技能数量总和 (AGENT + MCP + TOOLKIT + TOOL)
     */
    private Integer skillsCount;
}
