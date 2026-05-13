package com.iwhalecloud.byai.common.storage.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import lombok.Getter;
import lombok.Setter;

/**
 * FTP/SFTP存储配置类 从配置文件中读取FTP或SFTP相关配置
 *
 * @author he.duming
 * @date 2025-12-19 09:09:59
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "file.storage.ftp")
public class FtpConfig {

    /**
     * 协议或存储子类型标识（如 ftp、sftp），与业务约定一致
     */
    private String type;

    /**
     * FTP/SFTP服务端主机地址或域名
     */
    private String host;

    /**
     * 登录用户名
     */
    private String user;

    /**
     * 登录口令
     */
    private String pwd;

    /**
     * 服务端默认工作目录或上传根路径
     */
    private String path;

    /**
     * 开放资源（如工具 JSON）同步根目录，对应 MID_FTP_PATH_RESOURCE
     */
    private String pathResource;

    /**
     * 服务端端口，未配置时默认22（常见于SFTP）
     */
    private Integer port = 22;
}
