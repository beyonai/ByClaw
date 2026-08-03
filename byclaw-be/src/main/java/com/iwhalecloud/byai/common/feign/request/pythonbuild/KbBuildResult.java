package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * 查询知识库文件完整构建结果。
 *
 * @author qin.guoquan
 * @date 2026-08-03 19:38:38
 */
@Getter
@Setter
public class KbBuildResult {

    private String knCode;

    private String filePath;

    private Integer chunkPage;

    private Integer chunkPageSize;

    private Boolean includeMarkdown;
}
