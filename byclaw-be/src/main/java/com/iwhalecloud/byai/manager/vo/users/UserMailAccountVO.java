package com.iwhalecloud.byai.manager.vo.users;

import java.util.Date;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.iwhalecloud.byai.manager.dto.users.MailServerConfigDTO;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户个人邮箱账号安全视图，不返回授权码明文。
 * @author qin.guoquan
 * @date 2026-06-11 17:38:38
 */
@Getter
@Setter
public class UserMailAccountVO {

    private Long accountId;

    private String name;

    private String email;

    private String providerCode;

    private String authType;

    private List<String> capabilities;

    private Map<String, String> capabilityStatus;

    private List<String> setupRequirements;

    private String connectionState;

    private Date lastCheckTime;

    private String displayName;

    @JsonProperty("display_name")
    public String getDisplayNameSnake() {
        return displayName;
    }

    private MailServerConfigDTO imap;

    private MailServerConfigDTO smtp;

    private Boolean hasAuthCode;

    private String authCodeLast4;

    private String status;

    private Date updateTime;
}
