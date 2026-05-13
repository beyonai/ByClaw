package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-04-02
 * @description 删除文档请求体（POST /api/v1/knowledge-items/delete）
 */
@Getter
@Setter
public class KbFileDelete {

    /**
     * 知识库编码，必填
     */
    private String knCode;

    /**
     * 文件编码，必填
     */
    private String filePath;
}
