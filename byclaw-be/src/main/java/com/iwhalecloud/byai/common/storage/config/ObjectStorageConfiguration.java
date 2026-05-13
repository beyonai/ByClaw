package com.iwhalecloud.byai.common.storage.config;

import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.google.common.collect.ImmutableMap;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.ByAiArgumentException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.constants.StorageCategory;
import com.iwhalecloud.byai.common.storage.constants.StorageType;

import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;

/**
 * 对象存储配置类 负责从系统配置中读取对象存储相关配置，包括存储类型、存储服务配置和存储桶映射关系 支持MinIO和阿里云OSS两种存储类型，并为不同的存储类别配置对应的存储桶
 *
 * @author hux
 * @date 2025-08-15
 */
@Slf4j
@Configuration
public class ObjectStorageConfiguration {

    private static ThreadLocal<String> storageTypeThreadLocal = new ThreadLocal<String>();

    @Value("${file.storage.type:minio}")
    private String storageType;

    @Resource
    private MinioConfig minioConfig;

    @Resource
    private AliyunOssConfig aliyunOssConfig;

    @Resource
    private FtpConfig ftpConfig;

    /**
     * 当前线程切换储存类型
     * 
     * @param storageType 类型
     */
    public static void setStorageType(String storageType) {
        storageTypeThreadLocal.set(storageType);
    }

    /**
     * 存储类型如果当前线程有指定，优先返回当前线程，没有则使用默认存储方案
     * 
     * @return String
     */
    public String getStorageType() {
        if (storageTypeThreadLocal.get() != null) {
            return storageTypeThreadLocal.get();
        }
        return this.storageType;
    }

    /**
     * 存储类别与桶配置的映射关系 规则说明： 1. 从dc_system_config表中根据configCode获取配置项 2. 从配置项的JSON中根据jsonKey获取对应的桶名 3. 未在此映射中配置的存储类别将使用默认桶名
     * 当前配置： - ICON类型：从LOGO_CONFIG配置的bucket字段获取桶名 - SESSION类型：从KN_FILE_STORE_CONFIG配置的tempBucket字段获取桶名
     */
    private static final Map<StorageCategory, BucketConfig> BUCKET_CONFIG_MAPPING = ImmutableMap.of(
        StorageCategory.ICON, new BucketConfig("LOGO_CONFIG", "bucket"), StorageCategory.SESSION,
        new BucketConfig("KN_FILE_STORE_CONFIG", "tempBucket"));

    /**
     * 获取对象存储配置 从系统配置中读取文件存储配置，初始化存储类型、存储服务配置和存储桶映射关系 如果配置中未指定存储类型，则默认使用MinIO
     *
     * @return ObjectStorageProperties 对象存储属性配置，包含存储类型、服务配置和桶映射
     */
    public ObjectStorageProperties getStorageConfig() {

        String storageType = StringUtils.defaultIfBlank(this.getStorageType(), StorageType.MINIO);
        ObjectStorageProperties properties = new ObjectStorageProperties();
        properties.setStorageType(storageType);

        if (StorageType.MINIO.equalsIgnoreCase(this.getStorageType())) {
            properties.setMinio(this.minioConfig);
            this.initializeBucketMapping(properties);
        }
        else if (StorageType.ALI_YUN_OSS.equalsIgnoreCase(this.getStorageType())) {
            properties.setAliyunOss(this.aliyunOssConfig);
            this.initializeBucketMapping(properties);
        }
        else if (StorageType.FTP.equalsIgnoreCase(this.getStorageType())
            || StorageType.SFTP.equalsIgnoreCase(this.getStorageType())) {
            properties.setFtpConfig(this.ftpConfig);
        }
        else if (StorageType.LOCAL.equalsIgnoreCase(this.getStorageType())
            || StorageType.WHALE_AGENT.equalsIgnoreCase(this.getStorageType())) {
            this.initializeBucketMapping(properties);
        }
        else {
            throw new ByAiArgumentException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("storage.configuration.unsupported.storage.type", this.storageType));
        }
        return properties;
    }

    /**
     * 初始化存储桶映射关系 为所有存储类别设置默认桶名，然后根据BUCKET_CONFIG_MAPPING配置为特定类别设置专用桶名 如果专用桶配置不存在或获取失败，则继续使用默认桶名
     *
     * @param properties 对象存储属性配置对象，用于设置桶映射关系
     */
    private void initializeBucketMapping(ObjectStorageProperties properties) {
        Map<StorageCategory, String> bucketMapping = properties.getBucketMapping();

        String defaultBucketName = properties.getDefaultBucketName();
        for (StorageCategory storageCategory : StorageCategory.values()) {
            bucketMapping.put(storageCategory, defaultBucketName);
        }

        for (Map.Entry<StorageCategory, BucketConfig> entry : BUCKET_CONFIG_MAPPING.entrySet()) {
            String specialBucketName = getSpecialBucketFromConfig(entry.getValue());
            if (specialBucketName != null) {
                bucketMapping.put(entry.getKey(), specialBucketName);
            }
        }
    }

    /**
     * 从系统配置中获取特殊存储桶名称 根据桶配置信息从系统配置表中读取配置值，解析JSON并提取对应的桶名 如果配置不存在或解析失败，将记录警告日志并返回null
     *
     * @param bucketConfig 桶配置对象，包含配置代码(configCode)和JSON键名(jsonKey)
     * @return String 存储桶名称，如果配置不存在或解析失败则返回null
     */
    private String getSpecialBucketFromConfig(BucketConfig bucketConfig) {

        // String paramValue = dcSystemConfigService.getDcSystemConfigValueByCode(bucketConfig.getConfigCode());
        String paramValue = null;

        if (StringUtils.isEmpty(paramValue)) {
            log.warn("桶配置 {} 的配置值为空", bucketConfig.getConfigCode());
            return null;
        }

        JSONObject configJO = JSON.parseObject(paramValue);
        String bucket = configJO.getString(bucketConfig.getJsonKey());

        if (StringUtils.isBlank(bucket)) {
            log.warn("桶配置 {} 中未找到 {} 字段", bucketConfig.getConfigCode(), bucketConfig.getJsonKey());
            return null;
        }

        return bucket;
    }

}
