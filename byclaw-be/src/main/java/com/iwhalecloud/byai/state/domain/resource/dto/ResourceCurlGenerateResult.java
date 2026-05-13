package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Data;

/**
 * 资源 curl 生成结果。
 *
 * @author qin.guoquan
 * @date 2026-05-08 00:00:00
 */
@Data
public class ResourceCurlGenerateResult {

    /**
     * 可编辑、可执行的 curl 脚本。
     */
    private String curl;

    /**
     * 生成来源：RULE / LLM。
     */
    private String source;

    /**
     * 生成说明。
     */
    private String message;
}
