package com.iwhalecloud.byai.manager.dto.connector;

import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/** 连接器授权任务状态。 */
@Getter
@Setter
public class ConnectorAuthorizationDto {

    private String authorizationId;

    private Long connectorId;

    private String status;

    private String qrCodeUrl;

    private String authorizationUrl;

    private Date expiresAt;

    private String errorMessage;
}
