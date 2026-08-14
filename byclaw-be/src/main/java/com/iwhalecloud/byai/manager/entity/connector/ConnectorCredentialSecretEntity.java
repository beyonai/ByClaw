package com.iwhalecloud.byai.manager.entity.connector;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("byai_connector_credential_secret")
public class ConnectorCredentialSecretEntity {
    @TableId(value = "credential_id", type = IdType.INPUT)
    private Long credentialId;
    private String credentialReference;
    private String providerCode;
    private String userId;
    private Long connectorId;
    private String accessTokenCipher;
    private String refreshTokenCipher;
    private String tokenType;
    private String grantedScopes;
    private Date accessExpireTime;
    private Date refreshExpireTime;
    private String statusCd;
    private Date createTime;
    private Date updateTime;
}
