package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * 读取知识库文件内容响应。
 *
 * @author qin.guoquan
 * @date 2026-07-02 15:18:38
 */
@Getter
@Setter
public class KbFileReadResult {

    /**
     * 知识库编码。经 DatasetController 封装后会回映为 ByClaw resourceId。
     */
    private String knCode;

    private String filePath;

    private Integer startLine;

    private Integer endLine;

    /**
     * Markdown 文本内容。
     */
    private String data;

    /**
     * 是否已经读取到文件末尾。
     */
    private Boolean reachedEof;
}
