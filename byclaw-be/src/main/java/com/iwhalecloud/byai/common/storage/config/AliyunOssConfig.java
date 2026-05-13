package com.iwhalecloud.byai.common.storage.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import lombok.Getter;
import lombok.Setter;

/**
 * 阿里云OSS存储配置类 从配置文件中读取阿里云OSS相关配置
 *
 * @author he.duming
 * @date 2025-12-19 09:10:26
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "file.storage.aliyun-oss")
public class AliyunOssConfig {

    /**
     * 阿里云OSS访问密钥ID
     */
    private String accessKeyId;

    /**
     * 阿里云OSS访问密钥
     */
    private String accessKeySecret;

    /**
     * 阿里云OSS服务端点地址
     */
    private String ossEndpoint;

    /**
     * 默认存储桶名称
     */
    private String bucket;

    /**
     * 临时存储桶名称
     */
    private String tempBucket;

}
