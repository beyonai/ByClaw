package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * Agent DSL 纯元数据检索请求，对应 POST /api/v1/knowledgeItems/metadataSearch。
 *
 * @author qin.guoquan
 * @date 2026-08-06 10:38:38
 */
@Getter
@Setter
public class KbKnowledgeMetadataSearch {

    /** QA 知识库编码列表。 */
    private List<String> knCodeList = new ArrayList<>();

    /** Agent DSL 过滤 AST。 */
    private Map<String, Object> where;

    /** 需要返回的元数据字段。 */
    private List<String> metadataFieldList = new ArrayList<>();

    /** 未传 pageSize 时作为每页条数。 */
    private Integer topK;

    /** 页码，从 1 开始。 */
    private Integer pageNum;

    /** 每页条数，优先于 topK。 */
    private Integer pageSize;
}
