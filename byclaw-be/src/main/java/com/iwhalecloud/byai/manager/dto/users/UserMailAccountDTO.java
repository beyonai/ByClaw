package com.iwhalecloud.byai.manager.dto.users;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户个人邮箱账号保存/删除/设默认请求。
 * @author qin.guoquan
 * @date 2026-06-11 17:38:38
 */
@Getter
@Setter
public class UserMailAccountDTO {

    private Long accountId;

    private String name;

    private String email;

    private String displayName;

    @JsonProperty("display_name")
    private String displayNameSnake;

    @JsonProperty("default")
    private Boolean defaultAccount;

    private MailServerConfigDTO imap;

    private MailServerConfigDTO smtp;

    private String authCode;

    @JsonProperty("auth_code")
    private String authCodeSnake;
}
