package com.iwhalecloud.byai.state.domain.resource.qo;

import lombok.Getter;
import lombok.Setter;

/**
 * 数字员工技能查询（Open API 免登录）
 * 入参：数字员工ID、技能类型（可空）
 *
 * @author system
 * @date 2026-04-02
 */
@Getter
@Setter
public class OpenApiDigEmployeeSkillQo {

    /**
     * 数字员工ID
     */
    private Long resourceId;

    /**
     * 技能类型（可空），对应关联资源的 resource_biz_type
     * 例如：TOOLKIT-工具集, TOOL-工具, KG_DOC-文档知识库, KG_DB-数据知识库, KG_TERM-术语知识库, KG_QA-问答知识库 等
     */
    private String resourceBizType;
}
