package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * 知识库 chunk 检索结果项。
 *
 * @author qin.guoquan
 * @date 2026-07-02 15:18:38
 */
@Getter
@Setter
public class KnowledgeSearchItem {

    /** QA 知识库编码。 */
    private String knCode;

    /** 门户知识库资源 ID，由 DatasetController 根据 knCode 回映。 */
    private Long resourceId;

    private String filePath;

    private Integer chunkNo;

    private Long chunkId;

    private String chunkText;

    private Double score;

    private String imagePath;

    private Integer startLine;

    private Integer endLine;

    /** 按 metadataFieldList 返回的元数据。 */
    private Map<String, Object> metadata = new LinkedHashMap<>();
}
