package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

/**
 * 通过 ByClaw 知识库资源 ID 查询文件构建结果。
 *
 * @author qin.guoquan
 * @date 2026-08-03 19:38:38
 */
@Getter
@Setter
public class KnowledgeBuildResultRequest {

    private Long resourceId;

    private String filePath;

    private Integer chunkPage = 1;

    private Integer chunkPageSize = 20;

    private Boolean includeMarkdown = true;
}
