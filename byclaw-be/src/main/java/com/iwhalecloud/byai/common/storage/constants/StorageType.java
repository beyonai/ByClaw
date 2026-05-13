package com.iwhalecloud.byai.common.storage.constants;

/**
 * 存储类型常量类 定义系统支持的对象存储服务类型，用于标识和区分不同的存储后端
 *
 * @author he.duming
 * @date 2025-12-19 10:45:23
 */
public final class StorageType {

    /**
     * 私有构造函数，防止实例化
     */
    private StorageType() {
    }

    /**
     * MinIO存储类型 用于标识使用MinIO作为对象存储服务
     */
    public static final String MINIO = "minio";

    /**
     * 阿里云OSS存储类型 用于标识使用阿里云对象存储服务(OSS)作为存储后端
     */
    public static final String ALI_YUN_OSS = "aliyun-oss";

    /**
     * ftp服务
     */
    public static final String FTP = "ftp";

    /**
     * SFTP服务
     */
    public static final String SFTP = "sftp";

    /**
     * Local filesystem storage.
     */
    public static final String LOCAL = "local";

    /**
     * WHALE_AGENT 服务
     */
    public static final String WHALE_AGENT = "whale-agent";

}
