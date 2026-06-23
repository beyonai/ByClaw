package com.iwhalecloud.byai.manager.dto.users;

import lombok.Getter;
import lombok.Setter;

/**
 * 邮箱服务器配置，兼容前端 imap/smtp 嵌套结构。
 * @author qin.guoquan
 * @date 2026-06-11 17:38:38
 */
@Getter
@Setter
public class MailServerConfigDTO {

    private String host;

    private Integer port;

    private String encryption;
}
