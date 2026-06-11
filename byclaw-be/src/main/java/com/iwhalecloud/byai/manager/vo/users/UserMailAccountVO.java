package com.iwhalecloud.byai.manager.vo.users;

import java.util.Date;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.iwhalecloud.byai.manager.dto.users.MailServerConfigDTO;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户个人邮箱账号安全视图，不返回授权码明文。
 */
@Getter
@Setter
public class UserMailAccountVO {

    private Long accountId;

    private String name;

    private String email;

    private String displayName;

    @JsonProperty("display_name")
    public String getDisplayNameSnake() {
        return displayName;
    }

    @JsonProperty("default")
    private Boolean defaultAccount;

    private MailServerConfigDTO imap;

    private MailServerConfigDTO smtp;

    private Boolean hasAuthCode;

    private String authCodeLast4;

    private String status;

    private Date updateTime;
}
