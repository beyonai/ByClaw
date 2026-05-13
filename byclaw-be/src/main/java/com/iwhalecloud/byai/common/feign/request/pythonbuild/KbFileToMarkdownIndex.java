package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-04-02
 * @description 文件解析并建索引请求体（POST /api/v1/file-to-markdown-index）
 */
@Getter
@Setter
public class KbFileToMarkdownIndex {

    /**
     * 知识库编码
     */
    private String knCode;

    /**
     * 需构建的文档全路径，以 / 开头，不包括知识库名称
     */
    private String filePath;
}
