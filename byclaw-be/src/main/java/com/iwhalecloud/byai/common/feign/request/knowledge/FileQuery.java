package com.iwhalecloud.byai.common.feign.request.knowledge;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-09-25 17:28:00
 * @description TODO
 */
@Getter
@Setter
public class FileQuery {

    /**
     * contract_doc:文档 contract_chunk:分片
     */
    private String type;

    /**
     * 页码
     */
    private Long pageIndex = 1L;

    /**
     * 返回记录数
     */
    private Long pageSize = 2000L;

    /**
     * doc_id_list文档id列表,[1,2,3] 建议不超�?000�?
     */
    private List<Long> fileIds;

    /***
     * 关键字搜索
     */
    private List<String> keywords;

    /**
     * 关键字连接方式过滤
     */
    private KeywordsFilter keywords_filter;

    /**
     * 知识库标志
     */
    private List<Long> datasetIds = new ArrayList<>();

}
