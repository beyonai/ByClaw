package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * 创建目录请求体（POST /api/v1/directories/create），见 docs/api/api.md。
 */
@Getter
@Setter
public class KbDirectoryCreate {

    /** 知识库编码 */
    private String knCode;

    /** 目录路径，以 {@code /} 开头，不含知识库名，支持多级 */
    private String directoryPath;

    /** 目录描述，可选 */
    private String directoryDescription;
}
