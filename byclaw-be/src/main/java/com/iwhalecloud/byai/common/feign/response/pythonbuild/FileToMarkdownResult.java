package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 原始文件转 Markdown 的文件流结果。
 *
 * @author qin.guoquan
 * @date 2026-07-09 20:38:38
 */
@Getter
@AllArgsConstructor
public class FileToMarkdownResult {

    private final String fileName;

    private final String contentType;

    private final byte[] content;
}
