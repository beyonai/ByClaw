package com.iwhalecloud.byai.manager.dto.connector;

import lombok.Getter;
import lombok.Setter;

/** 安全返回给连接器表单的单个凭据字段定义。 */
@Getter
@Setter
public class ConnectorCredentialFieldDto {

    private String key;

    private String label;

    private String inputType;

    private Integer maxLength;
}
