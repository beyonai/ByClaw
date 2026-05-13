package com.iwhalecloud.byai.manager.dto.session;

import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * 模板会话查询请求DTO
 *
 * @author smartcloud
 */

@Getter
@Setter
public class TemplateSessionQueryRequestDto {

    private static final String DEFAULT_SORT_FIELD = "createTime";

    private static final String DEFAULT_SORT_ORDER = "desc";

    private Integer pageNum = 1;

    private Integer pageSize = 10;

    /**
     * 模板类型筛选，可选 支持多个类型，用逗号分隔，如：enterprise_qa,efficient_work
     */
    private String templateTypes;

    /**
     * 终端类型:ALL全端，PC端，APP端，
     */
    private List<String> terminals;

    /**
     * 关键字搜索，可选 支持搜索会话名称、模板标题等
     */
    private String keyword;

    /**
     * 创建者ID，可选
     */
    private Long creatorId;

    /**
     * 企业ID，可选
     */
    private Long enterpriseId;

    /**
     * 排序字段，可选 支持：createTime（创建时间）、updateTime（更新时间）、sessionName（会话名称） 默认按创建时间倒序
     */
    private String sortField = DEFAULT_SORT_FIELD;

    /**
     * 排序方向，可选 支持：asc（升序）、desc（降序） 默认降序
     */
    private String sortOrder = DEFAULT_SORT_ORDER;

    /**
     * 默认只查询模板会话
     */
    private Integer isDebug = 2;
}
