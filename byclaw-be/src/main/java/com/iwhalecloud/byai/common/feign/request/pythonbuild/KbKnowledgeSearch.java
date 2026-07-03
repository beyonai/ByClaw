package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import java.util.ArrayList;
import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * 知识库 chunk 检索请求体，对应 POST /api/v1/knowledgeItems/search。
 *
 * @author qin.guoquan
 * @date 2026-07-02 15:18:38
 */
@Getter
@Setter
public class KbKnowledgeSearch {

    /**
     * 检索问题。
     */
    private String query;

    /**
     * 知识库编码列表。
     */
    private List<String> knCodeList = new ArrayList<>();

    /**
     * 最终返回条数。
     */
    private Integer topK;

    /**
     * 文件类型过滤。
     */
    private List<String> fileTypeList = new ArrayList<>();

    /**
     * 检索模式：fullTextRecall、embedding、mixedRecall。
     */
    private String searchMode;
}
