package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

/**
 * 通过 ByClaw 知识库资源 ID 读取文件内容。
 *
 * @author qin.guoquan
 * @date 2026-07-02 15:18:38
 */
@Getter
@Setter
public class KnowledgeReadFileRequest {

    private Long resourceId;

    /**
     * 文件全路径，以 / 开头，不包括知识库名称。
     */
    private String filePath;

    private Integer startLine;

    private Integer endLine;
}
