package com.iwhalecloud.byai.state.domain.resource.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.storage.ResourceFS;
import com.iwhalecloud.byai.common.storage.util.MultipartFileUtil;

/**
 * 资源产物统一存储门面。
 *
 * 目标：
 * 1. 让 Tool / Dataset 等业务链只表达“我要发布资源产物”；
 * 2. 资源产物统一通过 ResourceFS 访问开放资源目录；
 * 3. 业务层始终只处理资源相对路径，不再感知底层存储协议。
 * @author qin.guoquan
 * @date 2026-04-18 15:22:00
 */
@Service
public class ResourceArtifactStorageService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ResourceArtifactStorageService.class);

    private static final String RESOURCE_ROOT_DIRECTORY = "resource";

    private static final String RESOURCE_ROOT_PATH = "/" + RESOURCE_ROOT_DIRECTORY;

    @Autowired
    private ResourceFS resourceFS;

    @Autowired
    private ResourceArtifactPathResolver resourceArtifactPathResolver;

    public void syncResourceJsonByBizType(String finalJson, String resourceBizType, long resourceId) {
        String dirName = resourceArtifactPathResolver.resolveResourceDirectory(resourceBizType);
        String fileName = resourceArtifactPathResolver.buildResourceJsonFileName(resourceBizType, resourceId);
        uploadToSubdirectory(finalJson.getBytes(java.nio.charset.StandardCharsets.UTF_8), dirName, fileName,
            "application/json");
    }

    /**
     * 按资源类型删除标准命名的 JSON 资源产物。
     * 目前主要给数字员工等“单 JSON 发布”场景复用。
     */
    public void deleteResourceJsonByBizType(String resourceBizType, long resourceId) {
        String dirName = resourceArtifactPathResolver.resolveResourceDirectory(resourceBizType);
        String fileName = resourceArtifactPathResolver.buildResourceJsonFileName(resourceBizType, resourceId);
        deleteWithinResourceRoot(dirName + "/" + fileName);
    }

    /**
     * 判断标准命名的 JSON 资源产物是否已存在。
     *
     * 统一给业务层提供“按 resourceBizType + resourceId 判断远端标准 JSON 是否存在”的能力，
     * 让上层无需关心底层存储实现。
     */
    public boolean existsResourceJsonByBizType(String resourceBizType, long resourceId) {
        String dirName = resourceArtifactPathResolver.resolveResourceDirectory(resourceBizType);
        String fileName = resourceArtifactPathResolver.buildResourceJsonFileName(resourceBizType, resourceId);
        String relativePath = dirName + "/" + fileName;
        return existsExactPath(buildResourceFilePath(relativePath));
    }

    public void uploadToSubdirectory(byte[] content, String subDirectory, String fileName, String contentType) {
        byte[] safeContent = content == null ? new byte[0] : content;
        String directoryPath = buildResourceDirectoryPath(subDirectory);
        MultipartFileUtil multipartFile = new MultipartFileUtil(fileName, fileName, contentType, safeContent);
        resourceFS.write(multipartFile, directoryPath);
        LOGGER.info("资源文件已同步至开放资源目录: path={}{}", directoryPath, fileName);
    }

    public void uploadDirectoryToSubdirectory(Path localRoot, String subDirectory) {
        uploadDirectory(localRoot, subDirectory);
    }

    public void renameWithinResourceRoot(String oldRelativePath, String newRelativePath) {
        renameWithinResourceRootInternal(oldRelativePath, newRelativePath);
    }

    public void deleteWithinResourceRoot(String relativePath) {
        deleteWithinResourceRootInternal(relativePath);
    }

    private void uploadDirectory(Path localRoot, String subDirectory) {
        if (localRoot == null || !Files.isDirectory(localRoot)) {
            throw new IllegalArgumentException("本地解压目录不存在");
        }
        try (Stream<Path> pathStream = Files.walk(localRoot)) {
            pathStream
                .filter(Files::isRegularFile)
                .filter(path -> !isMacMetadataPath(localRoot, path))
                .forEach(path -> uploadSingleLocalFile(localRoot, path, subDirectory));
            LOGGER.info("资源目录已同步至开放资源目录: localRoot={}, remoteDir={}", localRoot, subDirectory);
        }
        catch (IOException e) {
            throw new BaseException("资源目录同步失败", e);
        }
    }

    private void renameWithinResourceRootInternal(String oldRelativePath, String newRelativePath) {
        String oldPath = buildResourceFilePath(oldRelativePath);
        String newPath = buildResourceFilePath(newRelativePath);
        if (existsExactPath(oldPath)) {
            copyFile(oldPath, newPath);
            resourceFS.delete(oldPath);
            LOGGER.info("资源文件重命名成功: {} -> {}", oldPath, newPath);
            return;
        }

        String oldPrefix = ensureTrailingSlash(oldPath);
        List<String> sourcePaths = resourceFS.list(oldPrefix, null);
        if (sourcePaths == null || sourcePaths.isEmpty()) {
            LOGGER.warn("资源文件源路径不存在，跳过重命名: {}", oldPath);
            return;
        }
        String newPrefix = ensureTrailingSlash(newPath);
        for (String sourcePath : sourcePaths) {
            String targetPath = newPrefix + sourcePath.substring(oldPrefix.length());
            copyFile(sourcePath, targetPath);
        }
        resourceFS.delete(oldPrefix);
        LOGGER.info("资源目录重命名成功: {} -> {}", oldPrefix, newPrefix);
    }

    private void deleteWithinResourceRootInternal(String relativePath) {
        String resourcePath = buildResourceFilePath(relativePath);
        if (existsExactPath(resourcePath)) {
            resourceFS.delete(resourcePath);
            LOGGER.info("资源文件删除成功: path={}", resourcePath);
            return;
        }
        String prefix = ensureTrailingSlash(resourcePath);
        List<String> paths = resourceFS.list(prefix, null);
        if (paths == null || paths.isEmpty()) {
            LOGGER.warn("资源文件源路径不存在，跳过删除: {}", resourcePath);
            return;
        }
        resourceFS.delete(prefix);
        LOGGER.info("资源目录删除成功: prefix={}", prefix);
    }

    private void uploadSingleLocalFile(Path localRoot, Path filePath, String subDirectory) {
        try {
            byte[] bytes = Files.readAllBytes(filePath);
            String relativeFilePath = resourceArtifactPathResolver.normalizeRelativePath(localRoot.relativize(filePath).toString());
            String remoteDir = subDirectory;
            String fileName = filePath.getFileName().toString();
            int slashIndex = relativeFilePath.lastIndexOf('/');
            if (slashIndex >= 0) {
                remoteDir = resourceArtifactPathResolver.normalizeRelativePath(subDirectory) + "/"
                    + relativeFilePath.substring(0, slashIndex);
            }
            uploadToSubdirectory(bytes, remoteDir, fileName, "application/octet-stream");
        }
        catch (IOException e) {
            throw new BaseException("资源目录文件上传失败: " + filePath, e);
        }
    }

    private void copyFile(String sourcePath, String targetPath) {
        try (java.io.InputStream inputStream = resourceFS.read(sourcePath)) {
            if (inputStream == null) {
                throw new BaseException("资源文件复制失败，源文件不存在: " + sourcePath);
            }
            byte[] bytes = inputStream.readAllBytes();
            MultipartFileUtil multipartFile = new MultipartFileUtil(fileNameOf(targetPath), fileNameOf(targetPath),
                "application/octet-stream", bytes);
            resourceFS.write(multipartFile, targetPath);
        }
        catch (IOException e) {
            throw new BaseException("资源文件复制失败: " + sourcePath + " -> " + targetPath, e);
        }
    }

    private boolean existsExactPath(String resourcePath) {
        List<String> paths = resourceFS.list(resourcePath, null);
        if (paths == null || paths.isEmpty()) {
            return false;
        }
        return paths.stream().anyMatch(path -> StringUtils.equals(path, resourcePath));
    }

    private String buildResourceDirectoryPath(String subDirectory) {
        String normalizedSubDirectory = resourceArtifactPathResolver.normalizeRelativePath(subDirectory);
        if (StringUtils.isBlank(normalizedSubDirectory)) {
            return RESOURCE_ROOT_PATH + "/";
        }
        return RESOURCE_ROOT_PATH + "/" + normalizedSubDirectory + "/";
    }

    private String buildResourceFilePath(String relativePath) {
        String normalizedRelativePath = resourceArtifactPathResolver.normalizeRelativePath(relativePath);
        if (StringUtils.isBlank(normalizedRelativePath)) {
            return RESOURCE_ROOT_PATH;
        }
        return RESOURCE_ROOT_PATH + "/" + normalizedRelativePath;
    }

    private String ensureTrailingSlash(String path) {
        return StringUtils.endsWith(path, "/") ? path : path + "/";
    }

    private String fileNameOf(String path) {
        int slashIndex = path == null ? -1 : path.lastIndexOf('/');
        return slashIndex >= 0 ? path.substring(slashIndex + 1) : path;
    }

    private static boolean isMacMetadataPath(Path localRoot, Path filePath) {
        Path relativePath = localRoot.relativize(filePath);
        for (Path part : relativePath) {
            String name = StringUtils.trimToEmpty(part.toString());
            if (StringUtils.equalsIgnoreCase(name, "__MACOSX") || name.startsWith("._")) {
                return true;
            }
        }
        return false;
    }
}
