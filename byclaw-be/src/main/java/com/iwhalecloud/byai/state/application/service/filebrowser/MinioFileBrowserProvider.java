package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

@Component
public class MinioFileBrowserProvider implements FileBrowserProvider {

    private static final Logger LOGGER = LoggerFactory.getLogger(MinioFileBrowserProvider.class);

    private static final String ROOT_PREFIX = "by/";
    private static final String NAMESPACE = "workspace";
    private static final String SHARE_TYPE_PRIVATE = "private";

    private final ObjectStorage objectStorage;

    public MinioFileBrowserProvider(ObjectStorage objectStorage) {
        this.objectStorage = objectStorage;
    }

    @Override
    public List<FileBrowserItemVo> list(String userCode, Long resourceId, String relativePath) {
        String bucket = resolveBucket(userCode);
        String prefix = resolveAbsolutePath(resourceId, normalizeDirPath(relativePath));

        List<StorageObject> items = objectStorage.list(buildPrefix(bucket, prefix, false), null);
        List<FileBrowserItemVo> result = new ArrayList<>();

        for (StorageObject item : items) {
            String objectName = item.getPath();
            if (objectName.equals(prefix)) {
                continue;
            }
            FileBrowserItemVo vo = new FileBrowserItemVo();
            boolean isDir = item.isDir() || objectName.endsWith("/");
            vo.setDir(isDir);
            vo.setLastModified(item.getLastModified());
            if (isDir) {
                vo.setName(extractDirName(objectName, prefix));
                vo.setPath(toRelativePath(objectName));
            } else {
                vo.setName(extractFileName(objectName));
                vo.setPath(toRelativePath(objectName));
                vo.setSize(item.getSize());
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
            objectStorage.put(buildLocation(bucket, objectKey), file.getInputStream(), file.getSize(), contentType);
            LOGGER.info("文件上传成功: bucket={}, key={}", bucket, objectKey);
        }
    }

    @Override
    public InputStream download(String userCode, Long resourceId, String relativePath) {
        String bucket = resolveBucket(userCode);
        String objectKey = resolveAbsolutePath(resourceId, relativePath);
        return objectStorage.get(buildLocation(bucket, objectKey));
    }

    @Override
    public void delete(String userCode, Long resourceId, List<String> relativePaths) {
        String bucket = resolveBucket(userCode);
        for (String relativePath : relativePaths) {
            String absolutePath = resolveAbsolutePath(resourceId, relativePath);
            if (relativePath.endsWith("/")) {
                objectStorage.deletePrefix(buildPrefix(bucket, absolutePath, true));
            } else {
                objectStorage.delete(buildLocation(bucket, absolutePath));
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
            objectStorage.put(buildLocation(bucket, targetAbsolute), InputStream.nullInputStream(), 0L,
                "application/x-directory");
            List<StorageObject> items = objectStorage.list(buildPrefix(bucket, sourceAbsolute, true), null);
            for (StorageObject item : items) {
                String newKey = targetAbsolute + item.getPath().substring(sourceAbsolute.length());
                objectStorage.copy(buildLocation(bucket, item.getPath()), buildLocation(bucket, newKey));
            }
            objectStorage.deletePrefix(buildPrefix(bucket, sourceAbsolute, true));
        } else {
            objectStorage.move(buildLocation(bucket, sourceAbsolute), buildLocation(bucket, targetAbsolute));
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
                objectStorage.put(buildLocation(bucket, newPrefix), InputStream.nullInputStream(), 0L,
                    "application/x-directory");
                List<StorageObject> items = objectStorage.list(buildPrefix(bucket, sourceAbsolute, true), null);
                for (StorageObject item : items) {
                    String newKey = newPrefix + item.getPath().substring(sourceAbsolute.length());
                    objectStorage.copy(buildLocation(bucket, item.getPath()), buildLocation(bucket, newKey));
                }
                objectStorage.deletePrefix(buildPrefix(bucket, sourceAbsolute, true));
            } else {
                String fileName = extractFileName(sourceAbsolute);
                String newKey = targetAbsolute + fileName;
                objectStorage.move(buildLocation(bucket, sourceAbsolute), buildLocation(bucket, newKey));
            }
        }
        LOGGER.info("文件移动成功: bucket={}, targets -> {}", bucket, targetAbsolute);
    }

    @Override
    public void copy(String userCode, Long resourceId, String sourcePath, String targetDirectory) {
        String bucket = resolveBucket(userCode);
        String targetAbsolute = resolveAbsolutePath(resourceId, normalizeDirPath(targetDirectory));
        String sourceAbsolute = resolveAbsolutePath(resourceId, sourcePath);

        objectStorage.put(buildLocation(bucket, targetAbsolute), InputStream.nullInputStream(), 0L,
            "application/x-directory");

        if (sourcePath.endsWith("/")) {
            copyDirectory(bucket, sourceAbsolute, targetAbsolute);
        } else {
            String fileName = extractFileName(sourceAbsolute);
            objectStorage.copy(buildLocation(bucket, sourceAbsolute), buildLocation(bucket, targetAbsolute + fileName));
        }
        LOGGER.info("文件复制成功: bucket={}, {} -> {}", bucket, sourceAbsolute, targetAbsolute);
    }

    @Override
    public void createFolder(String userCode, Long resourceId, String relativePath) {
        String bucket = resolveBucket(userCode);
        String folderKey = resolveAbsolutePath(resourceId, normalizeDirPath(relativePath));
        objectStorage.put(buildLocation(bucket, folderKey), InputStream.nullInputStream(), 0L, "application/x-directory");
        LOGGER.info("文件夹创建成功: bucket={}, key={}", bucket, folderKey);
    }

    @Override
    public List<FileBrowserItemVo> search(String userCode, Long resourceId, String relativePath, String keyword) {
        String bucket = resolveBucket(userCode);
        String prefix = resolveAbsolutePath(resourceId, normalizeDirPath(relativePath));
        List<StorageObject> items = objectStorage.list(buildPrefix(bucket, prefix, true), null);
        List<FileBrowserItemVo> result = new ArrayList<>();

        for (StorageObject item : items) {
            String objectName = item.getPath();
            if (objectName.equals(prefix)) {
                continue;
            }
            boolean isDir = item.isDir() || objectName.endsWith("/");
            String fileName = extractFileName(objectName);
            if (!FileBrowserSearchMatcher.matches(fileName, toRelativePath(objectName), keyword)) {
                continue;
            }
            FileBrowserItemVo vo = new FileBrowserItemVo();
            vo.setDir(isDir);
            vo.setName(fileName);
            vo.setPath(toRelativePath(objectName));
            if (!isDir) {
                vo.setSize(item.getSize());
            }
            result.add(vo);
        }
        return result;
    }

    @Override
    public void downloadFolder(String userCode, Long resourceId, String relativePath, OutputStream outputStream) throws IOException {
        String bucket = resolveBucket(userCode);
        String prefix = resolveAbsolutePath(resourceId, normalizeDirPath(relativePath));

        List<StorageObject> items = objectStorage.list(buildPrefix(bucket, prefix, true), null);

        FileBrowserZipSupport.writeArchive(outputStream, zos -> {
            byte[] buffer = new byte[8192];
            for (StorageObject item : items) {
                if (item.isDir()) {
                    continue;
                }
                String objectName = item.getPath();
                if (objectName == null || !objectName.startsWith(prefix)) {
                    LOGGER.warn("文件夹下载跳过路径异常的对象: prefix={}, objectName={}", prefix, objectName);
                    continue;
                }
                String entryName = objectName.substring(prefix.length());
                if (entryName.isEmpty()) {
                    continue;
                }
                try (InputStream in = objectStorage.get(buildLocation(bucket, objectName))) {
                    FileBrowserZipSupport.writeEntry(zos, entryName, in, buffer, item.getSize());
                }
            }
        });
    }

    private String resolveBucket(String userCode) {
        return UserBucketNameResolver.buildUserBucketName(userCode);
    }

    private StorageLocation buildLocation(String bucket, String objectKey) {
        return StorageLocation.of(NAMESPACE, bucket, objectKey, SHARE_TYPE_PRIVATE);
    }

    private StoragePrefix buildPrefix(String bucket, String prefix, boolean recursive) {
        return StoragePrefix.of(NAMESPACE, bucket, prefix, SHARE_TYPE_PRIVATE, recursive);
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

    private void copyDirectory(String bucket, String sourceAbsolute, String targetAbsolute) {
        String sourcePrefix = normalizeDirPath(sourceAbsolute);
        String dirName = extractDirName(sourcePrefix,
            sourcePrefix.substring(0, sourcePrefix.lastIndexOf('/', sourcePrefix.length() - 2) + 1));
        String targetPrefix = targetAbsolute + dirName + "/";
        if (targetPrefix.startsWith(sourcePrefix)) {
            throw new IllegalArgumentException("不能复制文件夹到自身或其子目录下");
        }

        objectStorage.put(buildLocation(bucket, targetPrefix), InputStream.nullInputStream(), 0L,
            "application/x-directory");
        List<StorageObject> items = objectStorage.list(buildPrefix(bucket, sourcePrefix, true), null);
        for (StorageObject item : items) {
            String objectName = item.getPath();
            if (objectName.equals(sourcePrefix)) {
                continue;
            }
            String newKey = targetPrefix + objectName.substring(sourcePrefix.length());
            if (item.isDir() || objectName.endsWith("/")) {
                objectStorage.put(buildLocation(bucket, normalizeDirPath(newKey)), InputStream.nullInputStream(), 0L,
                    "application/x-directory");
            } else {
                objectStorage.copy(buildLocation(bucket, objectName), buildLocation(bucket, newKey));
            }
        }
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
