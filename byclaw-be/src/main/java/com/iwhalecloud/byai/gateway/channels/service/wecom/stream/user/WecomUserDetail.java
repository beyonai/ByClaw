package com.iwhalecloud.byai.gateway.channels.service.wecom.stream.user;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * Minimal WeCom contact profile returned by {@code /cgi-bin/user/get}.
 */
@Getter
@Setter
public class WecomUserDetail {

    private String userid;
    private String name;
    private String mobile;
    private String email;
    private List<Long> department;
}
