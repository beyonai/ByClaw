package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Data;

/**
 * 资源 curl 运行请求。
 *
 * @author qin.guoquan
 * @date 2026-05-08 00:00:00
 */
@Data
public class ResourceCurlRunRequest {

    /**
     * 资源ID。
     */
    private Long resourceId;

    /**
     * 前端脚本框中的 curl 内容。
     */
    private String curl;
}
