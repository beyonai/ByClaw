package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Data;

/**
 * curl 导入请求 DTO
 */
@Data
public class CurlImportRequest {

    /**
     * 外键id
     */
    private Long pkId;

    /**
     * 原始 curl 命令字符串
     */
    private String curl;
}
