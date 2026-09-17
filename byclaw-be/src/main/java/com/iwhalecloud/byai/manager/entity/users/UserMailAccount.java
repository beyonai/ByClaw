package com.iwhalecloud.byai.manager.entity.users;

import java.util.Date;

import lombok.Getter;
import lombok.Setter;

/**
 * 用户个人邮箱配置值对象，序列化后加密存入个人参数表；不是独立数据库实体。
 * @author qin.guoquan
 * @date 2026-06-11 17:38:38
 */
@Getter
@Setter
public class UserMailAccount {

    private Long accountId;

    private Long userId;

    private String accountName;

    private String email;

    private String displayName;

    private String providerCode;

    private Long connectorId;

    private String authType;

    private String credentialRef;

    private String imapHost;

    private Integer imapPort;

    private String imapEncryption;

    private String smtpHost;

    private Integer smtpPort;

    private String smtpEncryption;

    private String authCodeCipher;

    private String authCodeLast4;

    private String status;

    private Date lastCheckTime;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
