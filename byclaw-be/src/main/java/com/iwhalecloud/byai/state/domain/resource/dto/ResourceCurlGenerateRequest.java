package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Data;

/**
 * 资源 curl 生成请求。
 *
 * @author qin.guoquan
 * @date 2026-05-08 00:00:00
 */
@Data
public class ResourceCurlGenerateRequest {

    /**
     * 资源ID。
     */
    private Long resourceId;

}
