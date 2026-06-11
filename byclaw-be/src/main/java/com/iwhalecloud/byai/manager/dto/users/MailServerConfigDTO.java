package com.iwhalecloud.byai.manager.dto.users;

import lombok.Getter;
import lombok.Setter;

/**
 * 邮箱服务器配置，兼容前端 imap/smtp 嵌套结构。
 */
@Getter
@Setter
public class MailServerConfigDTO {

    private String host;

    private Integer port;

    private String encryption;
}
