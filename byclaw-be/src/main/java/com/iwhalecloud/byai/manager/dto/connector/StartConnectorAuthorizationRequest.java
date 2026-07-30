package com.iwhalecloud.byai.manager.dto.connector;

import lombok.Getter;
import lombok.Setter;

/** 前端授权请求，connectorId 使用业务编码而非数据库主键。 */
@Getter
@Setter
public class StartConnectorAuthorizationRequest {

    private String connectorId;

    private String redirectUrl;
}
