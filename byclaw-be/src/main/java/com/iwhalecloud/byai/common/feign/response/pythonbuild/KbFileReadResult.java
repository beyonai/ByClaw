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

    /** QA 知识库编码。 */
    private String knCode;

    /** 门户知识库资源 ID。 */
    private Long resourceId;

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
