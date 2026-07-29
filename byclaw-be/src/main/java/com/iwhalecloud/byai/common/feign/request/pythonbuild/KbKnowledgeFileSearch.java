package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * Agent DSL 文件级语义检索请求，对应 POST /api/v1/knowledgeItems/searchFile。
 *
 * @author qin.guoquan
 * @date 2026-7-13 17:38:38
 */
@Getter
@Setter
public class KbKnowledgeFileSearch {

    /** 检索文本。 */
    private String query;

    /** QA 知识库编码列表。 */
    private List<String> knCodeList = new ArrayList<>();

    /** Agent DSL 过滤 AST，按原结构透传给 QA。 */
    private Map<String, Object> where;

    /** 检索模式：fullTextRecall、embedding、mixedRecall。 */
    private String searchMode;

    /** 需要返回的元数据字段。 */
    private List<String> metadataFieldList = new ArrayList<>();

    /** 最终返回的文件数。 */
    private Integer topK;
}
