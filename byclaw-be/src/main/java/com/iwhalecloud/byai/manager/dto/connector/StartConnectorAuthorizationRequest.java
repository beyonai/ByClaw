package com.iwhalecloud.byai.manager.dto.connector;

import lombok.Getter;
import lombok.Setter;

/** 前端授权请求，connectorId 使用数据库主键。 */
@Getter
@Setter
public class StartConnectorAuthorizationRequest {

    private Long connectorId;

    private String redirectUrl;
}
