package com.iwhalecloud.byai.common.storage.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * MinIO存储配置类 从配置文件中读取MinIO相关配置
 *
 * @author he.duming
 * @date 2025-12-19 09:09:59
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "file.storage.minio")
public class MinioConfig {

    /**
     * MinIO 服务主机地址
     */
    private String host;

    /**
     * 对应配置项 file.storage.minio.api.port。
     * MinIO API 端口只保留这一套分层配置方式，不再兼容旧的扁平字段。
     */
    private Api api = new Api();

    /**
     * MinIO访问密钥
     */
    private String accessKey;

    /**
     * MinIO密钥
     */
    private String secretKey;

    /**
     * 是否使用 HTTPS 连接 MinIO。
     */
    private Boolean secure;

    /**
     * 默认存储桶名称
     */
    private String bucketName;

    /**
     * 临时存储桶名称
     */
    private String tempBucket;

    /**
     * MinIO bucket 挂载配置。
     * 这部分配置描述“把哪些 bucket 挂载到哪些宿主机上的哪个根目录”。
     */
    private Mount mount = new Mount();

    /**
     * 兼容现有对象存储抽象，默认桶仍对外暴露为 getBucket()。
     */
    public String getBucket() {
        return bucketName;
    }

    /**
     * 对外统一暴露 endpoint，内部按 host + api.port 收口。
     */
    public String getEndpoint() {
        if (host == null || host.trim().isEmpty()) {
            return null;
        }
        String trimmedHost = host.trim();
        Integer apiPort = api == null ? null : api.getPort();
        if (apiPort == null) {
            return trimmedHost;
        }
        return trimmedHost + ":" + apiPort;
    }

    @Getter
    @Setter
    public static class Api {

        /**
         * 对应配置项 file.storage.minio.api.port
         */
        private Integer port;
    }

    @Getter
    @Setter
    public static class Mount {

        /**
         * 是否启用 bucket 挂载。
         */
        private Boolean enabled;

        /**
         * 宿主机上的挂载根目录。
         * 例如 /data/8080/，最终 byclaw 会映射到 /data/8080/byclaw。
         */
        private String path;

        /**
         * 需要执行挂载的宿主机列表。
         * 每台宿主机都允许独立配置 host/port/user/password。
         */
        private List<Target> targets = new ArrayList<>();
    }

    @Getter
    @Setter
    public static class Target {

        /**
         * 宿主机地址
         */
        private String host;

        /**
         * SSH 端口
         */
        private Integer port;

        /**
         * SSH 用户名
         */
        private String user;

        /**
         * SSH 密码
         */
        private String password;

        /**
         * 是否启用当前宿主机挂载
         */
        private Boolean enabled;
    }
}
