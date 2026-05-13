package com.iwhalecloud.byai.state.domain.resource.dto;

import java.util.Map;
import lombok.Data;

/**
 * 资源 curl 运行结果。
 *
 * @author qin.guoquan
 * @date 2026-05-08 00:00:00
 */
@Data
public class ResourceCurlRunResult {

    /**
     * 是否执行成功。
     */
    private Boolean success;

    /**
     * HTTP 状态码。
     */
    private Integer statusCode;

    /**
     * 响应头。
     */
    private Map<String, String> headers;

    /**
     * 响应体。
     */
    private String body;

    /**
     * 执行耗时，单位毫秒。
     */
    private Long durationMs;

    /**
     * 错误说明。
     */
    private String errorMessage;
}
