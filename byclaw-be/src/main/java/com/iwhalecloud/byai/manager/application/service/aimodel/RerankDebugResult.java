package com.iwhalecloud.byai.manager.application.service.aimodel;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * RERANK 调试代理响应结果：statusCode、contentType、body
 *
 * <p>说明：RERANK 为非流式接口，调试时需要尽量透传上游响应，便于排障。
 *
 * @author system
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RerankDebugResult {

    /**
     * 上游 HTTP 状态码
     */
    private int statusCode;

    /**
     * 上游 Content-Type
     */
    private String contentType;

    /**
     * 上游响应体原文（通常为 JSON）
     */
    private String body;
}

