package com.iwhalecloud.byai.common.storage.validation;

/**
 * 资源 JSON 连通性校验服务。
 * @author qin.guoquan
 * @date 2026-05-18 14:12:18
 */
public interface ResourceJsonConnectivityValidationService {

    void validate(ResourceJsonValidationContext context);
}
