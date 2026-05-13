package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * 删除目录请求体（POST /api/v1/directories/delete），见 docs/api/api.md。
 */
@Getter
@Setter
public class KbDirectoryDelete {

    /** 知识库编码 */
    private String knCode;

    /** 待删除目录路径，以 {@code /} 开头，不含知识库名 */
    private String directoryPath;
}
