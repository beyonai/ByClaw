package com.iwhalecloud.byai.state.domain.resource.service;

import java.nio.charset.StandardCharsets;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.storage.FileIngressService;
import com.iwhalecloud.byai.common.storage.config.FtpConfig;
import com.iwhalecloud.byai.common.storage.config.ObjectStorageConfiguration;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import com.iwhalecloud.byai.common.storage.util.MultipartFileUtil;

/**
 * 统一封装资源 JSON 到开放资源 FTP 目录的同步逻辑。
 * 目录按 resourceBizType 小写命名，文件名按 resourceBizType 大写命名。
 * @author qin.guoquan
 * @date 2026-04-18 15:00:08
 */
@Service
public class ResourceJsonFtpSyncService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ResourceJsonFtpSyncService.class);

    @Autowired
    private FileIngressService fileIngressService;

    @Autowired
    private FtpConfig ftpConfig;

    @Autowired
    private ResourceArtifactPathResolver pathResolver;

    /**
     * 按资源业务类型同步 JSON 到开放资源目录。
     *
     * @param finalJson        最终落库 JSON
     * @param resourceBizType  资源业务类型
     * @param resourceId       资源ID
     */
    public void syncByResourceBizType(String finalJson, String resourceBizType, long resourceId) {
        String absoluteBasePath = pathResolver.resolveFtpAbsoluteBasePath();
        if (StringUtils.isBlank(absoluteBasePath)) {
            LOGGER.warn("未配置 file.storage.ftp.path，跳过资源 JSON 远程同步");
            return;
        }
        byte[] bytes = finalJson.getBytes(StandardCharsets.UTF_8);
        String dirName = pathResolver.resolveResourceDirectory(resourceBizType);
        String fileName = pathResolver.buildResourceJsonFileName(resourceBizType, resourceId);
        MultipartFileUtil multipartFile = new MultipartFileUtil(fileName, fileName, "application/json", bytes);

        ObjectStorageConfiguration.setStorageType(ftpConfig.getType());
        FileStorageContext fileStorageContext = FileStorageContext.ftpCustomBasePathWithSubdirectory(absoluteBasePath, dirName, true);
        fileIngressService.uploadFile(multipartFile, fileStorageContext);
        LOGGER.info("资源 JSON 已同步至开放资源目录: {}/{}", dirName, fileName);
    }
}
