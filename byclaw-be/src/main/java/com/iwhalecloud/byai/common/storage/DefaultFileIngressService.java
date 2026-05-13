package com.iwhalecloud.byai.common.storage;

import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.regex.Pattern;

import org.apache.commons.io.FilenameUtils;
import org.apache.commons.lang3.RandomStringUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.config.ObjectStorageConfiguration;
import com.iwhalecloud.byai.common.storage.config.ObjectStorageProperties;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import com.iwhalecloud.byai.common.storage.model.ParsedFileInfo;
import com.iwhalecloud.byai.common.storage.util.FileUtil;

import cn.hutool.crypto.digest.DigestUtil;

/**
 * Default application-facing file ingress implementation.
 */
@Primary
@Service
public class DefaultFileIngressService implements FileIngressService {

    private static final Logger logger = LoggerFactory.getLogger(DefaultFileIngressService.class);

    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("yyyyMMdd");

    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("HHmmss");

    private static final Pattern SPECIAL_CHAR_PATTERN = Pattern.compile("[#%￥&?:*\"<>| ]");

    private final FileIngressBackendRegistry fileIngressBackendRegistry;

    private final ObjectStorageConfiguration objectStorageConfiguration;

    public DefaultFileIngressService(FileIngressBackendRegistry fileIngressBackendRegistry,
        ObjectStorageConfiguration objectStorageConfiguration) {
        this.fileIngressBackendRegistry = fileIngressBackendRegistry;
        this.objectStorageConfiguration = objectStorageConfiguration;
    }

    @Override
    public FileMetadata uploadFile(MultipartFile multipartFile, FileStorageContext fileStorageContext, String bucketName) {
        FileIngressBackend backend = resolveBackend(fileStorageContext);
        try {
            String fileName = fileStorageContext.isUseOriginalName()
                ? normalizeFileName(multipartFile.getOriginalFilename())
                : generateFileName(multipartFile.getOriginalFilename());
            MultipartFile normalizedMultipartFile = createNormalizedMultipartFile(multipartFile, fileName);
            ensureBucketExists(backend, bucketName);
            FileMetadata fileMetadata = backend.upload(normalizedMultipartFile, fileStorageContext.getPath(),
                bucketName, fileStorageContext);
            fileMetadata.setFileMd5(calculateFileMd5(multipartFile));
            fileMetadata.setStorageType(backend.getStorageType());
            return fileMetadata;
        }
        catch (Exception e) {
            logger.error("文件上传失败: {}", multipartFile.getOriginalFilename(), e);
            throw new RuntimeException(I18nUtil.get("storage.abstract.file.upload.failed", e.getMessage()), e);
        }
    }

    @Override
    public FileMetadata uploadFile(MultipartFile multipartFile, FileStorageContext fileStorageContext) {
        String bucketName = getStorageProperties().getBucketName(fileStorageContext.getStorageCategory());
        return uploadFile(multipartFile, fileStorageContext, bucketName);
    }

    @Override
    public InputStream downloadFile(String fileUrl) {
        if (StringUtils.isBlank(fileUrl)) {
            throw new RuntimeException(I18nUtil.get("storage.abstract.file.url.cannot.be.empty"));
        }
        ParsedFileInfo fileInfo = FileUtil.parseFileUrl(fileUrl);
        FileIngressBackend backend = fileIngressBackendRegistry.getConfiguredBackend();
        try {
            return backend.download(fileInfo.getFilePath(), fileInfo.getBucketName());
        }
        catch (Exception e) {
            logger.error("文件下载失败: {}", fileUrl, e);
            throw new RuntimeException(I18nUtil.get("storage.abstract.file.download.failed", e.getMessage()), e);
        }
    }

    @Override
    public void deleteFile(String fileUrl) {
        ParsedFileInfo fileInfo = FileUtil.parseFileUrl(fileUrl);
        FileIngressBackend backend = fileIngressBackendRegistry.getConfiguredBackend();
        try {
            backend.deleteByPath(fileInfo.getFilePath(), fileInfo.getBucketName());
        }
        catch (Exception e) {
            logger.error("文件删除失败: {}", fileUrl, e);
            throw new RuntimeException(I18nUtil.get("storage.abstract.file.delete.failed", e.getMessage()), e);
        }
    }

    @Override
    public void deleteFiles(List<String> fileUrls) {
        for (String fileUrl : fileUrls) {
            if (fileUrl != null) {
                deleteFile(fileUrl);
            }
        }
    }

    @Override
    public FileMetadata getObjectMetadata(String fileUrl) {
        ParsedFileInfo fileInfo = FileUtil.parseFileUrl(fileUrl);
        FileIngressBackend backend = fileIngressBackendRegistry.getConfiguredBackend();
        return backend.getMetadata(fileInfo.getFilePath(), fileInfo.getBucketName());
    }

    private FileIngressBackend resolveBackend(FileStorageContext fileStorageContext) {
        if (StringUtils.isNotBlank(fileStorageContext.getStorageType())) {
            return fileIngressBackendRegistry.getBackend(fileStorageContext.getStorageType());
        }
        return fileIngressBackendRegistry.getConfiguredBackend();
    }

    private void ensureBucketExists(FileIngressBackend storage, String bucketName) {
        try {
            boolean created = storage.createBucketIfNeeded(bucketName);
            if (created) {
                logger.info("{}桶创建成功: {}", storage.getStorageType(), bucketName);
            }
        }
        catch (Exception e) {
            logger.error("检查或创建{}桶失败: {}", storage.getStorageType(), bucketName, e);
            throw new RuntimeException(I18nUtil.get("storage.abstract.check.or.create.bucket.failed", bucketName), e);
        }
    }

    private ObjectStorageProperties getStorageProperties() {
        return objectStorageConfiguration.getStorageConfig();
    }

    private String normalizeFileName(String fileName) {
        return SPECIAL_CHAR_PATTERN.matcher(fileName).replaceAll("_");
    }

    private String generateFileName(String originalFileName) {
        LocalDateTime now = LocalDateTime.now();
        String date = now.format(DATE_FORMATTER);
        String time = now.format(TIME_FORMATTER);
        String uuid = RandomStringUtils.randomAlphabetic(3);
        return String.format("%s-%s%s_%s", date, time, uuid, normalizeFileName(originalFileName));
    }

    private String calculateFileMd5(MultipartFile multipartFile) {
        try {
            return DigestUtil.md5Hex(multipartFile.getInputStream());
        }
        catch (IOException e) {
            logger.error("文件：{}，上传重构后计算md5失败：", multipartFile.getOriginalFilename());
            return "";
        }
    }

    private MultipartFile createNormalizedMultipartFile(MultipartFile originalFile, String normalizedFileName) {
        return new MultipartFile() {
            @Override
            public String getName() {
                return originalFile.getOriginalFilename();
            }

            @Override
            public String getOriginalFilename() {
                return normalizedFileName;
            }

            @Override
            public String getContentType() {
                return originalFile.getContentType();
            }

            @Override
            public boolean isEmpty() {
                return originalFile.isEmpty();
            }

            @Override
            public long getSize() {
                return originalFile.getSize();
            }

            @Override
            public byte[] getBytes() throws IOException {
                return originalFile.getBytes();
            }

            @Override
            public InputStream getInputStream() throws IOException {
                return originalFile.getInputStream();
            }

            @Override
            public void transferTo(java.io.File dest) throws IOException, IllegalStateException {
                originalFile.transferTo(dest);
            }
        };
    }
}
