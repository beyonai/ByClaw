package com.iwhalecloud.byai.common.storage.util;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.common.storage.model.ParsedFileInfo;
import org.springframework.util.MultiValueMap;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * 文件工具类 提供文件访问URL生成等工具方法
 */
public final class FileUtil {

    private static final Logger logger = LoggerFactory.getLogger(FileUtil.class);


    /**
     * 默认的通用文件预览API前缀
     */
    public static final String DEFAULT_COMMON_FILE_PREVIEW_PREFIX = "/WaManagerService/commonFile/preview";

    /**
     * 私有构造函数，防止实例化
     */
    private FileUtil() {
    }

    /**
     * 生成文件访问URL
     *
     * @param bucketName 存储桶名称
     * @param objectName 对象名称（文件路径）
     * @param storageType 存储类型
     * @return 文件访问URL
     */
    public static String generateFileAccessUrl(String bucketName, String objectName, String storageType) {
        return DEFAULT_COMMON_FILE_PREVIEW_PREFIX + "?" + "style=" + storageType.toUpperCase() + "&" + "systemCode=BYAI"
            + "&" + "bucketName=" + bucketName + "&" + "fileName=" + objectName;
    }

    public static ParsedFileInfo parseFileUrl(String fileUrl) {
        try {
            MultiValueMap<String, String> queryParams = UriComponentsBuilder.fromUriString(fileUrl).build()
                .getQueryParams();
            String objectUrl = queryParams.getFirst("fileName");
            String bucketName = queryParams.getFirst("bucketName");

            return ParsedFileInfo.builder().bucketName(bucketName).filePath(objectUrl).build();
        }
        catch (Exception e) {
            logger.error("解析MinIO文件URL失败: {}", fileUrl, e);
            return ParsedFileInfo.builder().filePath(fileUrl).build();
        }
    }
}
