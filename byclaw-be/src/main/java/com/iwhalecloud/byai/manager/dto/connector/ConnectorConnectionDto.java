package com.iwhalecloud.byai.manager.dto.connector;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/** 当前用户可见的连接器授权状态，connectorId 使用业务编码。 */
@Getter
@Setter
public class ConnectorConnectionDto {

    private String connectorId;

    private String status;

    private String accountName;

    private String credentialState;

    private String renewalMode;

    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ssXXX", timezone = "GMT+8")
    @JSONField(serializeUsing = CredentialExpirationFastJsonSerializer.class)
    private Date accessExpiresAt;

    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ssXXX", timezone = "GMT+8")
    @JSONField(serializeUsing = CredentialExpirationFastJsonSerializer.class)
    private Date refreshExpiresAt;

    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ssXXX", timezone = "GMT+8")
    @JSONField(serializeUsing = CredentialExpirationFastJsonSerializer.class)
    private Date lastVerifiedAt;
}
