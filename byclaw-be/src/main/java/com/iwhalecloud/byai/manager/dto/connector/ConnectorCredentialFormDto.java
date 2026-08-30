package com.iwhalecloud.byai.manager.dto.connector;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

/** 安全返回给前端的凭据表单定义，不包含任何凭据值。 */
@Getter
@Setter
public class ConnectorCredentialFormDto {

    private String helpUrl;

    private String helpLinkText;

    private String helpText;

    private List<ConnectorCredentialFieldDto> fields;
}
