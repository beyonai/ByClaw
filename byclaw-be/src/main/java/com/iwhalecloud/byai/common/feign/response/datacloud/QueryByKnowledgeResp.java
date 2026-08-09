package com.iwhalecloud.byai.common.feign.response.datacloud;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 按知识库查询对象列表响应 data（POST /api/v1/ontologyBases/objects/queryByKnowledge）。
 */
@Getter
@Setter
public class QueryByKnowledgeResp {

    /** 当前页对象基本信息 */
    private List<QueryByKnowledgeItem> items;

    /** 过滤后、分页前的对象总数 */
    private Integer total;

    /** 当前页码 */
    private Integer pageIndex;

    /** 当前每页数量 */
    private Integer pageSize;

    /** 总页数 */
    private Integer totalPages;
}
