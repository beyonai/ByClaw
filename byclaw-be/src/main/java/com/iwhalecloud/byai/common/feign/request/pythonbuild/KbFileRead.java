package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * 读取知识库文件内容请求体，对应 POST /api/v1/readFile。
 *
 * @author qin.guoquan
 * @date 2026-07-02 15:18:38
 */
@Getter
@Setter
public class KbFileRead {

    /**
     * 知识库编码。
     */
    private String knCode;

    /**
     * 文件全路径，以 / 开头，不包括知识库名称。
     */
    private String filePath;

    /**
     * Markdown 起始行，不传表示从文件开头读取。
     */
    private Integer startLine;

    /**
     * Markdown 结束行，不传表示读取到文件末尾。
     */
    private Integer endLine;
}
