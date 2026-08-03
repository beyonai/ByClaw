package com.iwhalecloud.byai.manager.dto.connector;

import lombok.Getter;
import lombok.Setter;

/** 当前用户可见的连接器授权状态，connectorId 使用业务编码。 */
@Getter
@Setter
public class ConnectorConnectionDto {

    private String connectorId;

    private String status;

    private String accountName;
}
