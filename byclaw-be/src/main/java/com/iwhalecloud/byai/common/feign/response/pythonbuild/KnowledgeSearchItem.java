package com.iwhalecloud.byai.common.feign.response.pythonbuild;

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

    /**
     * 知识库编码。经 DatasetController 封装后会回映为 ByClaw resourceId。
     */
    private String knCode;

    private String filePath;

    private Integer chunkNo;

    private Long chunkId;

    private String chunkText;

    private Double score;

    private String imagePath;

    private Integer startLine;

    private Integer endLine;
}
