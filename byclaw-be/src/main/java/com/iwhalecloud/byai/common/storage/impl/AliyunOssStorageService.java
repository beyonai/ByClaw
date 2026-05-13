package com.iwhalecloud.byai.common.storage.impl;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.InputStream;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSClientBuilder;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.AbstractFileIngressStorageService;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import com.iwhalecloud.byai.common.storage.config.AliyunOssConfig;
import com.iwhalecloud.byai.common.storage.constants.StorageType;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;

/**
 * 阿里云OSS存储服务实现类 提供基于阿里云OSS的文件存储功能
 *
 * @author he.duming
 * @date 2025-12-18 20:53:03
 */
@Component
public class AliyunOssStorageService extends AbstractFileIngressStorageService<OSS> {

    private static final Logger logger = LoggerFactory.getLogger(AliyunOssStorageService.class);


    @Autowired
    private AliyunOssConfig aliyunOssConfig;

    /**
     * 获取存储类型
     *
     * @return 存储类型标识
     */
    @Override
    public String getStorageType() {
        return StorageType.ALI_YUN_OSS;
    }

    /**
     * 创建阿里云OSS客户端
     *
     * @return OSS客户端实例
     * @throws BaseException 客户端创建失败时抛出异常
     */
    @Override
    protected OSS createStorageClient() {

        try {

            String ossEndpoint = aliyunOssConfig.getOssEndpoint();
            String accessKeyId = aliyunOssConfig.getAccessKeyId();
            String accessKeySecret = aliyunOssConfig.getAccessKeySecret();

            OSS ossClient = new OSSClientBuilder().build(ossEndpoint, accessKeyId, accessKeySecret);

            logger.info("阿里云OSS客户端创建成功, endpoint: {}", aliyunOssConfig.getOssEndpoint());
            return ossClient;
        }
        catch (Exception e) {
            logger.error("创建阿里云OSS客户端失败", e);
            throw new BaseException(I18nUtil.get("storage.aliyun.oss.create.client.failed", e.getMessage()), e);
        }
    }

    /**
     * 上传文件到阿里云OSS
     *
     * @param multipartFile 待上传的文件
     * @param storagePath 存储路径
     * @param bucketName 存储桶名称
     * @return 文件元数据信息
     */
    @Override
    protected FileMetadata doUploadFile(MultipartFile multipartFile, String storagePath, String bucketName,
        FileStorageContext fileStorageContext) {
        return null;
    }

    /**
     * 从阿里云OSS下载文件
     *
     * @param fileId 文件ID
     * @param bucketName 存储桶名称
     * @return 文件输入流
     */
    @Override
    protected InputStream doDownloadFile(String fileId, String bucketName) {
        return null;
    }

    /**
     * 删除阿里云OSS中的文件
     *
     * @param objectUrl 对象URL地址
     * @param bucketName 存储桶名称
     */
    @Override
    protected void doDeleteFile(String objectUrl, String bucketName) {

    }

    /**
     * 获取阿里云OSS对象的元数据信息
     *
     * @param objectKey 对象键
     * @param bucketName 存储桶名称
     * @return 文件元数据信息
     */
    @Override
    protected FileMetadata doGetObjectMetadata(String objectKey, String bucketName) {
        return null;
    }

    /**
     * 创建阿里云OSS存储桶
     *
     * @param bucketName 存储桶名称
     * @return 创建是否成功
     */
    @Override
    protected boolean doCreateBucket(String bucketName) {
        return false;
    }
}
