package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.impl.MinioStorageService;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

import io.minio.messages.Item;

@Component
public class MinioFileBrowserProvider implements FileBrowserProvider {

    private static final Logger LOGGER = LoggerFactory.getLogger(MinioFileBrowserProvider.class);

    private static final String ROOT_PREFIX = "by/";

    private final MinioStorageService minioStorageService;

    public MinioFileBrowserProvider(MinioStorageService minioStorageService) {
        this.minioStorageService = minioStorageService;
    }

    @Override
    public List<FileBrowserItemVo> list(String userCode, Long resourceId, String relativePath) {
        String bucket = resolveBucket(userCode);
        String prefix = resolveAbsolutePath(resourceId, normalizeDirPath(relativePath));

        List<Item> items = minioStorageService.listObjectKeys(bucket, prefix, false);
        List<FileBrowserItemVo> result = new ArrayList<>();

        for (Item item : items) {
            String objectName = item.objectName();
            if (objectName.equals(prefix)) {
                continue;
            }
            FileBrowserItemVo vo = new FileBrowserItemVo();
            vo.setDir(item.isDir());
            if (item.isDir()) {
                vo.setName(extractDirName(objectName, prefix));
                vo.setPath(toRelativePath(objectName));
            } else {
                vo.setName(extractFileName(objectName));
                vo.setPath(toRelativePath(objectName));
                vo.setSize(item.size());
                if (item.lastModified() != null) {
                    vo.setLastModified(item.lastModified().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME));
                }
            }
            result.add(vo);
        }
        return result;
    }

    @Override
    public void upload(String userCode, Long resourceId, String relativePath, MultipartFile[] files) throws Exception {
        String bucket = resolveBucket(userCode);
        String dirPath = resolveAbsolutePath(resourceId, normalizeDirPath(relativePath));

        for (MultipartFile file : files) {
            if (file.isEmpty()) {
                continue;
            }
            String objectKey = dirPath + file.getOriginalFilename();
            String contentType = file.getContentType();
            if (StringUtils.isBlank(contentType)) {
                contentType = "application/octet-stream";
            }
            minioStorageService.uploadBytes(bucket, objectKey, file.getBytes(), contentType);
            LOGGER.info("文件上传成功: bucket={}, key={}", bucket, objectKey);
        }
    }

    @Override
    public InputStream download(String userCode, Long resourceId, String relativePath) {
        String bucket = resolveBucket(userCode);
        String objectKey = resolveAbsolutePath(resourceId, relativePath);
        StorageLocation location = StorageLocation.of("", bucket, objectKey);
        return minioStorageService.get(location);
    }

    @Override
    public void delete(String userCode, Long resourceId, List<String> relativePaths) {
        String bucket = resolveBucket(userCode);
        for (String relativePath : relativePaths) {
            String absolutePath = resolveAbsolutePath(resourceId, relativePath);
            if (relativePath.endsWith("/")) {
                List<Item> items = minioStorageService.listObjectKeys(bucket, absolutePath, true);
                for (Item item : items) {
                    minioStorageService.deleteObjectIfExists(bucket, item.objectName());
                }
            } else {
                minioStorageService.deleteObjectIfExists(bucket, absolutePath);
            }
            LOGGER.info("文件删除成功: bucket={}, path={}", bucket, absolutePath);
        }
    }

    @Override
    public void rename(String userCode, Long resourceId, String sourcePath, String newName) {
        String bucket = resolveBucket(userCode);
        String sourceAbsolute = resolveAbsolutePath(resourceId, sourcePath);

        String parentDir = sourceAbsolute.substring(0, sourceAbsolute.lastIndexOf('/', sourceAbsolute.length() - 2) + 1);
        String targetAbsolute = parentDir + newName;

        if (sourcePath.endsWith("/")) {
            targetAbsolute = targetAbsolute.endsWith("/") ? targetAbsolute : targetAbsolute + "/";
            List<Item> items = minioStorageService.listObjectKeys(bucket, sourceAbsolute, true);
            for (Item item : items) {
                String newKey = targetAbsolute + item.objectName().substring(sourceAbsolute.length());
                minioStorageService.copyObject(bucket, item.objectName(), newKey);
                minioStorageService.deleteObjectIfExists(bucket, item.objectName());
            }
        } else {
            minioStorageService.copyObject(bucket, sourceAbsolute, targetAbsolute);
            minioStorageService.deleteObjectIfExists(bucket, sourceAbsolute);
        }
        LOGGER.info("文件重命名成功: bucket={}, {} -> {}", bucket, sourceAbsolute, targetAbsolute);
    }

    @Override
    public void move(String userCode, Long resourceId, List<String> sourcePaths, String targetDirectory) {
        String bucket = resolveBucket(userCode);
        String targetAbsolute = resolveAbsolutePath(resourceId, normalizeDirPath(targetDirectory));

        for (String sourcePath : sourcePaths) {
            String sourceAbsolute = resolveAbsolutePath(resourceId, sourcePath);
            if (sourcePath.endsWith("/")) {
                String dirName = extractDirName(sourceAbsolute,
                    sourceAbsolute.substring(0, sourceAbsolute.lastIndexOf('/', sourceAbsolute.length() - 2) + 1));
                String newPrefix = targetAbsolute + dirName + "/";
                List<Item> items = minioStorageService.listObjectKeys(bucket, sourceAbsolute, true);
                for (Item item : items) {
                    String newKey = newPrefix + item.objectName().substring(sourceAbsolute.length());
                    minioStorageService.copyObject(bucket, item.objectName(), newKey);
                    minioStorageService.deleteObjectIfExists(bucket, item.objectName());
                }
            } else {
                String fileName = extractFileName(sourceAbsolute);
                String newKey = targetAbsolute + fileName;
                minioStorageService.copyObject(bucket, sourceAbsolute, newKey);
                minioStorageService.deleteObjectIfExists(bucket, sourceAbsolute);
            }
        }
        LOGGER.info("文件移动成功: bucket={}, targets -> {}", bucket, targetAbsolute);
    }

    @Override
    public void createFolder(String userCode, Long resourceId, String relativePath) {
        String bucket = resolveBucket(userCode);
        String folderKey = resolveAbsolutePath(resourceId, normalizeDirPath(relativePath));
        minioStorageService.uploadBytes(bucket, folderKey, new byte[0], "application/x-directory");
        LOGGER.info("文件夹创建成功: bucket={}, key={}", bucket, folderKey);
    }

    @Override
    public List<FileBrowserItemVo> search(String userCode, Long resourceId, String relativePath, String keyword) {
        String bucket = resolveBucket(userCode);
        String prefix = resolveAbsolutePath(resourceId, normalizeDirPath(relativePath));
        String lowerKeyword = keyword.toLowerCase();

        List<Item> items = minioStorageService.listObjectKeys(bucket, prefix, true);
        List<FileBrowserItemVo> result = new ArrayList<>();

        for (Item item : items) {
            String objectName = item.objectName();
            if (objectName.equals(prefix)) {
                continue;
            }
            boolean isDir = item.isDir() || objectName.endsWith("/");
            String fileName = extractFileName(objectName);
            if (!fileName.toLowerCase().contains(lowerKeyword)) {
                continue;
            }
            FileBrowserItemVo vo = new FileBrowserItemVo();
            vo.setDir(isDir);
            vo.setName(fileName);
            vo.setPath(toRelativePath(objectName));
            if (!isDir) {
                vo.setSize(item.size());
                if (item.lastModified() != null) {
                    vo.setLastModified(item.lastModified().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME));
                }
            }
            result.add(vo);
        }
        return result;
    }

    @Override
    public void downloadFolder(String userCode, Long resourceId, String relativePath, OutputStream outputStream) throws IOException {
        String bucket = resolveBucket(userCode);
        String prefix = resolveAbsolutePath(resourceId, normalizeDirPath(relativePath));

        List<Item> items = minioStorageService.listObjectKeys(bucket, prefix, true);

        try (ZipOutputStream zos = new ZipOutputStream(outputStream)) {
            byte[] buffer = new byte[8192];
            for (Item item : items) {
                if (item.isDir()) {
                    continue;
                }
                String objectName = item.objectName();
                String entryName = objectName.substring(prefix.length());
                if (entryName.isEmpty()) {
                    continue;
                }
                zos.putNextEntry(new ZipEntry(entryName));
                StorageLocation location = StorageLocation.of("", bucket, objectName);
                try (InputStream in = minioStorageService.get(location)) {
                    int len;
                    while ((len = in.read(buffer)) > 0) {
                        zos.write(buffer, 0, len);
                    }
                }
                zos.closeEntry();
            }
        }
    }

    private String resolveBucket(String userCode) {
        return UserBucketNameResolver.buildUserBucketName(userCode);
    }

    private String resolveAbsolutePath(Long resourceId, String relativePath) {
        String normalized = normalizeRelativePath(relativePath);
        String absolutePath = ROOT_PREFIX + normalized;
        if (!absolutePath.startsWith(ROOT_PREFIX)) {
            throw new IllegalArgumentException("非法路径: " + relativePath);
        }
        return absolutePath;
    }

    private String normalizeRelativePath(String path) {
        if (StringUtils.isBlank(path) || "/".equals(path)) {
            return "";
        }
        if (path.contains("..")) {
            throw new IllegalArgumentException("路径不允许包含 '..' : " + path);
        }
        return path.startsWith("/") ? path.substring(1) : path;
    }

    private String normalizeDirPath(String path) {
        if (StringUtils.isBlank(path) || "/".equals(path)) {
            return "/";
        }
        return path.endsWith("/") ? path : path + "/";
    }

    private String toRelativePath(String absolutePath) {
        if (absolutePath.startsWith(ROOT_PREFIX)) {
            String rel = absolutePath.substring(ROOT_PREFIX.length());
            return rel.isEmpty() ? "/" : "/" + rel;
        }
        return absolutePath;
    }

    private String extractFileName(String objectName) {
        if (objectName.endsWith("/")) {
            objectName = objectName.substring(0, objectName.length() - 1);
        }
        int lastSlash = objectName.lastIndexOf('/');
        return lastSlash >= 0 ? objectName.substring(lastSlash + 1) : objectName;
    }

    private String extractDirName(String objectName, String parentPrefix) {
        String relative = objectName.substring(parentPrefix.length());
        if (relative.endsWith("/")) {
            relative = relative.substring(0, relative.length() - 1);
        }
        int slash = relative.indexOf('/');
        return slash >= 0 ? relative.substring(0, slash) : relative;
    }
}
