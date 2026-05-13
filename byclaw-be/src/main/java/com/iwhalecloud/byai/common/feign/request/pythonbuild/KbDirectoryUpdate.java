package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * 修改目录请求体（POST /api/v1/directories/update），见 docs/api/api.md。
 */
@Getter
@Setter
public class KbDirectoryUpdate {

    /** 知识库编码 */
    private String knCode;

    /** 待修改目录当前路径，以 {@code /} 开头，不含知识库名 */
    private String directoryPath;

    /** 新目录名，仅替换 {@code directoryPath} 最后一级 */
    private String directoryName;
}
