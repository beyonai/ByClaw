package com.iwhalecloud.byai.manager.entity.users;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户个人邮箱账号配置。
 * @author qin.guoquan
 * @date 2026-06-11 17:38:38
 */
@Getter
@Setter
@TableName("po_user_mail_account")
public class UserMailAccount {

    @TableId
    private Long accountId;

    private Long userId;

    private String accountName;

    private String email;

    private String displayName;

    private String defaultFlag;

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
