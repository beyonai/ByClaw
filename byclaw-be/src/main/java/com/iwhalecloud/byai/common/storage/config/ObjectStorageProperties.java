package com.iwhalecloud.byai.common.storage.config;


import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.exception.ByAiArgumentException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.constants.StorageCategory;
import com.iwhalecloud.byai.common.storage.constants.StorageType;
import lombok.Getter;
import lombok.Setter;

/**
 * 对象存储属性配置类 封装对象存储的配置信息，包括存储类型、存储服务配置和存储桶映射关系
 *
 * @author hux
 * @date 2025-08-12
 */
@Getter
@Setter
public class ObjectStorageProperties {

    private static final Logger logger = LoggerFactory.getLogger(ObjectStorageProperties.class);


    /**
     * 存储类型，支持MINIO|ALI_YUN_OSS|FTP|SFTP｜LOCAL｜WHALE_AGENT
     */
    private String storageType;

    /**
     * MinIO存储服务配置
     */
    private MinioConfig minio = new MinioConfig();

    /**
     * 阿里云OSS存储服务配置
     */
    private AliyunOssConfig aliyunOss = new AliyunOssConfig();

    /**
     * ftp配置存储服务配置
     */
    private FtpConfig ftpConfig = new FtpConfig();

    /**
     * 存储类别与存储桶名称的映射关系
     */
    private final Map<StorageCategory, String> bucketMapping = new ConcurrentHashMap<>();

    /**
     * 根据存储类别获取对应的存储桶名称
     *
     * @param storageCategory 存储类别
     * @return 存储桶名称
     */
    public String getBucketName(StorageCategory storageCategory) {
        return bucketMapping.get(storageCategory);
    }

    /**
     * 获取默认存储桶名称 根据当前存储类型返回对应的默认桶名
     *
     * @return 默认存储桶名称
     * @throws ByAiArgumentException 当存储类型不支持时抛出异常
     */
    protected String getDefaultBucketName() {
        return switch (this.storageType) {
            case StorageType.MINIO -> this.getMinio().getBucket();
            case StorageType.ALI_YUN_OSS -> this.getAliyunOss().getBucket();
            case StorageType.FTP, StorageType.SFTP -> this.getFtpConfig().getPath();
            case StorageType.LOCAL, StorageType.WHALE_AGENT -> "";
            default -> throw new ByAiArgumentException(
                I18nUtil.get("storage.properties.unsupported.storage.type", this.storageType));
        };
    }

    /**
     * 将配置Map转换为指定类型的配置对象
     *
     * @param config 配置Map
     * @param clazz 目标类型
     * @param <T> 配置对象类型
     * @return 转换后的配置对象
     * @throws BaseException 配置转换失败时抛出异常
     */
    private static <T> T convertConfig(Map<String, Object> config, Class<T> clazz) {
        try {
            return JSON.parseObject(JSON.toJSONString(config), clazz);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException(I18nUtil.get("storage.properties.config.conversion.failed", clazz.getSimpleName()),
                e);
        }
    }
}
