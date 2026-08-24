package com.iwhalecloud.byai.manager.dto.connector;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 连接器列表返回 DTO。
 */
@Getter
@Setter
public class ConnectorListDto {

    /** 连接器ID */
    private Long connectorId;

    /** 连接器业务编码 */
    private String connectorCode;

    /** 连接器展示名称 */
    private String connectorName;

    /** 连接器类型：SYSTEM / CUSTOM */
    private String connectorType;

    /** 连接器功能简介 */
    private String description;

    /** 当前用户连接启用标识：Y=开启，N=关闭；未绑定时为 null。 */
    private String enableFlag;

    /** 兼容字段，值与 accessExpiresAt 相同。 */
    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ssXXX", timezone = "GMT+8")
    @JSONField(serializeUsing = CredentialExpirationFastJsonSerializer.class)
    private Date credentialExpiresAt;

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
