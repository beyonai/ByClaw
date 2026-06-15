package com.iwhalecloud.byai.state.application.service.fs;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLConnection;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.Callable;

import org.apache.commons.io.IOUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.ResourceFS;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.common.util.MultipartFileUtil;
import com.iwhalecloud.byai.state.domain.fs.dto.FsDirectoryRequest;
import com.iwhalecloud.byai.state.domain.fs.dto.FsFileDeleteRequest;
import com.iwhalecloud.byai.state.domain.fs.dto.FsRenameRequest;
import com.iwhalecloud.byai.state.domain.fs.enums.FsSpaceType;
import com.iwhalecloud.byai.state.domain.fs.vo.FsDeleteResultVo;
import com.iwhalecloud.byai.state.domain.fs.vo.FsDirectoryRenameFailedItemVo;
import com.iwhalecloud.byai.state.domain.fs.vo.FsDirectoryRenameResultVo;
import com.iwhalecloud.byai.state.domain.fs.vo.FsFileMetadataVo;
import com.iwhalecloud.byai.state.domain.fs.vo.FsRenameResultVo;

/**
 * UserFS / ResourceFS 的统一文件操作编排层。
 * Controller 只负责协议转换，这里集中处理路径规范化、空间路由和资源权限校验。
 *
 * @author qin.guoquan
 * @date 2026-06-10 17:38:38
 */
@Service
public class FsOperationApplicationService {

    /**
     * MinIO 没有真实空目录概念，创建目录时写入一个 marker 对象用于占位。
     */
    private static final String DIRECTORY_MARKER = ".keep";

    private static final String DIRECTORY_CONTENT_TYPE = "application/x-directory";

    private static final String DEFAULT_CONTENT_TYPE = "application/octet-stream";

    private static final String USER_FS_ROOT = "/by";

    private static final String USER_BUCKET_PREFIX = "/byclaw-";

    @Autowired
    private UserFS userFS;

    @Autowired
    private ResourceFS resourceFS;

    @Autowired
    private AuthApplicationService authApplicationService;

    @Autowired
    private SsResourceService ssResourceService;

    public FsFileMetadataVo putFile(String spaceTypeValue, Long resourceId, String path, String contentType,
        MultipartFile file) {
        return doPutFile(spaceTypeValue, resourceId, path, contentType, file);
    }

    public FsFileMetadataVo putFileAsUser(String userCode, String spaceTypeValue, Long resourceId, String path,
        String contentType, MultipartFile file) {
        return runAsUserCode(userCode, () -> doPutFile(spaceTypeValue, resourceId, path, contentType, file));
    }

    private FsFileMetadataVo doPutFile(String spaceTypeValue, Long resourceId, String path, String contentType,
        MultipartFile file) {
        FsSpaceType spaceType = FsSpaceType.of(spaceTypeValue);
        String normalizedPath = normalizeFilePath(spaceType, path);
        // USER 空间只要求当前登录用户；RESOURCE 空间必须校验资源管理权限。
        checkWritePermission(spaceType, resourceId, normalizedPath);
        MultipartFile uploadFile = adaptContentType(file, normalizedPath, contentType);
        FileMetadata metadata = write(spaceType, uploadFile, normalizedPath);
        return toFileMetadataVo(spaceType, resourceId, normalizedPath, metadata);
    }

    public FsDownload downloadFile(String spaceTypeValue, Long resourceId, String path) {
        return doDownloadFile(null, spaceTypeValue, resourceId, path);
    }

    public FsDownload downloadFileAsUser(String userCode, String spaceTypeValue, Long resourceId, String path) {
        return runAsUserCode(userCode, () -> doDownloadFile(userCode, spaceTypeValue, resourceId, path));
    }

    private FsDownload doDownloadFile(String runAsUserCode, String spaceTypeValue, Long resourceId, String path) {
        FsSpaceType spaceType = FsSpaceType.of(spaceTypeValue);
        String normalizedPath = normalizeFilePath(spaceType, path);
        checkReadPermission(spaceType, resourceId, normalizedPath);
        String fileName = fileNameOf(normalizedPath);
        String contentType = StringUtils.defaultIfBlank(URLConnection.guessContentTypeFromName(fileName),
            DEFAULT_CONTENT_TYPE);
        StreamingResponseBody body =
            outputStream -> runAsUserCode(runAsUserCode, () -> {
                streamFile(spaceType, normalizedPath, outputStream);
                return null;
            });
        return new FsDownload(fileName, contentType, body);
    }

    public FsDeleteResultVo deleteFile(FsFileDeleteRequest request) {
        return doDeleteFile(request);
    }

    public FsDeleteResultVo deleteFileAsUser(String userCode, FsFileDeleteRequest request) {
        return runAsUserCode(userCode, () -> doDeleteFile(request));
    }

    private FsDeleteResultVo doDeleteFile(FsFileDeleteRequest request) {
        FsSpaceType spaceType = FsSpaceType.of(request.getSpaceType());
        String normalizedPath = normalizeFilePath(spaceType, request.getPath());
        checkWritePermission(spaceType, request.getResourceId(), normalizedPath);
        boolean deleted = delete(spaceType, normalizedPath);
        FsDeleteResultVo vo = new FsDeleteResultVo();
        vo.setSpaceType(spaceType.name());
        vo.setResourceId(request.getResourceId());
        vo.setPath(normalizedPath);
        vo.setDeleted(deleted);
        vo.setRecursive(false);
        vo.setDeletedCount(deleted ? 1 : 0);
        return vo;
    }

    public List<String> listFiles(String spaceTypeValue, Long resourceId, String path, Integer maxDepth) {
        return doListFiles(spaceTypeValue, resourceId, path, maxDepth);
    }

    public List<String> listFilesAsUser(String userCode, String spaceTypeValue, Long resourceId, String path,
        Integer maxDepth) {
        return runAsUserCode(userCode, () -> doListFiles(spaceTypeValue, resourceId, path, maxDepth));
    }

    private List<String> doListFiles(String spaceTypeValue, Long resourceId, String path, Integer maxDepth) {
        FsSpaceType spaceType = FsSpaceType.of(spaceTypeValue);
        String normalizedPath = normalizeSpacePath(spaceType, path);
        checkReadPermission(spaceType, resourceId, normalizedPath);
        return list(spaceType, normalizedPath, maxDepth);
    }

    public FsDeleteResultVo createDirectory(FsDirectoryRequest request) {
        FsSpaceType spaceType = FsSpaceType.of(request.getSpaceType());
        String normalizedPath = normalizeDirectoryPath(spaceType, request.getPath());
        checkWritePermission(spaceType, request.getResourceId(), normalizedPath);
        // 对象存储只保存对象，空目录通过写入 .keep marker 来显式创建。
        writeBytes(spaceType, markerPath(normalizedPath), new byte[0], DIRECTORY_CONTENT_TYPE);
        FsDeleteResultVo vo = new FsDeleteResultVo();
        vo.setSpaceType(spaceType.name());
        vo.setResourceId(request.getResourceId());
        vo.setPath(normalizedPath);
        vo.setDeleted(false);
        vo.setCreated(true);
        vo.setRecursive(false);
        vo.setDeletedCount(0);
        return vo;
    }

    public FsDeleteResultVo deleteDirectory(FsDirectoryRequest request) {
        FsSpaceType spaceType = FsSpaceType.of(request.getSpaceType());
        String normalizedPath = normalizeDirectoryPath(spaceType, request.getPath());
        checkWritePermission(spaceType, request.getResourceId(), normalizedPath);
        List<String> paths = list(spaceType, normalizedPath);
        boolean recursive = !Boolean.FALSE.equals(request.getRecursive());
        if (!recursive && hasNonMarkerContent(paths, normalizedPath)) {
            // 非递归删除允许删除“只有 marker 的空目录”，但不能误删已有业务文件。
            throw new BaseException("byclaw.fs.directory.not.empty");
        }
        boolean deleted = delete(spaceType, normalizedPath);
        FsDeleteResultVo vo = new FsDeleteResultVo();
        vo.setSpaceType(spaceType.name());
        vo.setResourceId(request.getResourceId());
        vo.setPath(normalizedPath);
        vo.setRecursive(recursive);
        vo.setDeleted(deleted);
        vo.setDeletedCount(paths.size());
        return vo;
    }

    public FsRenameResultVo renameFile(FsRenameRequest request) {
        FsSpaceType spaceType = FsSpaceType.of(request.getSpaceType());
        String oldPath = normalizeFilePath(spaceType, request.getOldPath());
        String newPath = normalizeFilePath(spaceType, request.getNewPath());
        checkWritePermission(spaceType, request.getResourceId(), oldPath);
        if (spaceType == FsSpaceType.RESOURCE) {
            validateResourcePath(request.getResourceId(), newPath);
        }
        ensureTargetWritable(spaceType, newPath, Boolean.TRUE.equals(request.getOverwrite()));
        copyFile(spaceType, oldPath, newPath);
        delete(spaceType, oldPath);
        FsRenameResultVo vo = new FsRenameResultVo();
        vo.setSpaceType(spaceType.name());
        vo.setResourceId(request.getResourceId());
        vo.setOldPath(oldPath);
        vo.setNewPath(newPath);
        vo.setMoved(true);
        vo.setOverwritten(Boolean.TRUE.equals(request.getOverwrite()));
        return vo;
    }

    public FsDirectoryRenameResultVo renameDirectory(FsRenameRequest request) {
        FsSpaceType spaceType = FsSpaceType.of(request.getSpaceType());
        String oldPath = normalizeDirectoryPath(spaceType, request.getOldPath());
        String newPath = normalizeDirectoryPath(spaceType, request.getNewPath());
        checkWritePermission(spaceType, request.getResourceId(), oldPath);
        if (spaceType == FsSpaceType.RESOURCE) {
            validateResourcePath(request.getResourceId(), newPath);
        }

        List<String> sourcePaths = list(spaceType, oldPath);
        List<String> copiedSourcePaths = new ArrayList<>();
        FsDirectoryRenameResultVo result = new FsDirectoryRenameResultVo();
        result.setSpaceType(spaceType.name());
        result.setResourceId(request.getResourceId());
        result.setOldPath(oldPath);
        result.setNewPath(newPath);
        result.setTotal(sourcePaths.size());
        result.setCopied(0);
        result.setDeleted(0);
        result.setFailed(0);

        for (String sourcePath : sourcePaths) {
            if (StringUtils.endsWith(sourcePath, "/")) {
                // 兼容部分存储实现可能返回目录占位路径，真正搬迁只处理对象文件。
                continue;
            }
            String targetPath = newPath + StringUtils.removeStart(sourcePath, oldPath);
            try {
                ensureTargetWritable(spaceType, targetPath, Boolean.TRUE.equals(request.getOverwrite()));
                copyFile(spaceType, sourcePath, targetPath);
                copiedSourcePaths.add(sourcePath);
                result.setCopied(result.getCopied() + 1);
            }
            catch (Exception e) {
                addFailedItem(result, sourcePath, targetPath, "COPY", e);
            }
        }

        // MinIO 没有原子 rename，目录重命名采用 copy + delete；只删除已经复制成功的源对象，避免半失败时丢数据。
        for (String sourcePath : copiedSourcePaths) {
            try {
                delete(spaceType, sourcePath);
                result.setDeleted(result.getDeleted() + 1);
            }
            catch (Exception e) {
                addFailedItem(result, sourcePath, null, "DELETE", e);
            }
        }
        return result;
    }

    private void checkReadPermission(FsSpaceType spaceType, Long resourceId, String path) {
        checkLogin();
        if (spaceType == FsSpaceType.RESOURCE) {
            // RESOURCE 空间归属平台资源，读操作要求资源可访问权限。
            validateResourcePath(resourceId, path);
            SsResource resource = findResource(resourceId);
            if (!authApplicationService.hasResourceAccessPermission(resource)) {
                throw new BaseException("byclaw.fs.resource.access.denied");
            }
        }
    }

    private void checkWritePermission(FsSpaceType spaceType, Long resourceId, String path) {
        checkLogin();
        if (spaceType == FsSpaceType.RESOURCE) {
            // 写、删除、重命名都会改变资源内容，必须具备资源管理权限。
            validateResourcePath(resourceId, path);
            SsResource resource = findResource(resourceId);
            if (!authApplicationService.hasResourceManagePermission(resource)) {
                throw new BaseException("byclaw.fs.resource.manage.denied");
            }
        }
    }

    private void checkLogin() {
        if (CurrentUserHolder.getLoginInfo() == null || StringUtils.isBlank(CurrentUserHolder.getCurrentUserCode())) {
            throw new BaseException("byclaw.fs.user.not.login");
        }
    }

    private SsResource findResource(Long resourceId) {
        if (resourceId == null) {
            throw new BaseException("byclaw.fs.resource.id.not.empty");
        }
        SsResource resource = ssResourceService.findById(resourceId);
        if (resource == null) {
            throw new BaseException("byclaw.fs.resource.not.exist");
        }
        return resource;
    }

    private void validateResourcePath(Long resourceId, String path) {
        if (!StringUtils.startsWith(path, "/resource/")) {
            throw new BaseException("byclaw.fs.resource.path.prefix.invalid");
        }
        if (resourceId == null) {
            return;
        }
        String resourceIdText = String.valueOf(resourceId);
        boolean belongsToResource = StringUtils.contains(path, "_" + resourceIdText + "/")
            || StringUtils.endsWith(path, "_" + resourceIdText)
            || StringUtils.endsWith(path, "_" + resourceIdText + ".json")
            || StringUtils.contains(path, "/" + resourceIdText + "/")
            || StringUtils.endsWith(path, "/" + resourceIdText);
        if (!belongsToResource) {
            // resourceId 决定权限，path 决定实际对象；两者必须一致，避免用 A 资源权限操作 B 资源文件。
            throw new BaseException("byclaw.fs.resource.path.not.belong.resource");
        }
    }

    private FileMetadata write(FsSpaceType spaceType, MultipartFile file, String path) {
        if (file == null) {
            throw new BaseException("byclaw.fs.upload.file.not.empty");
        }
        if (spaceType == FsSpaceType.USER) {
            userFS.init();
            return userFS.write(file, path);
        }
        resourceFS.init();
        return resourceFS.write(file, path);
    }

    private void writeBytes(FsSpaceType spaceType, String path, byte[] bytes, String contentType) {
        String resolvedContentType = StringUtils.defaultIfBlank(contentType, DEFAULT_CONTENT_TYPE);
        // 内部生成的小对象直接走流式写入，避免再伪造成 MultipartFile。
        if (spaceType == FsSpaceType.USER) {
            userFS.init();
            userFS.write(new java.io.ByteArrayInputStream(bytes), bytes.length, resolvedContentType, path);
            return;
        }
        resourceFS.init();
        resourceFS.write(new java.io.ByteArrayInputStream(bytes), bytes.length, resolvedContentType, path);
    }

    private void copyFile(FsSpaceType spaceType, String sourcePath, String targetPath) {
        try (InputStream inputStream = read(spaceType, sourcePath)) {
            if (inputStream == null) {
                throw new BaseException("byclaw.fs.source.file.not.exist");
            }
            // 当前 FS read 只返回 InputStream，不返回长度；这里读取后再用流式 write 写入目标对象。
            byte[] bytes = inputStream.readAllBytes();
            writeBytes(spaceType, targetPath, bytes, URLConnection.guessContentTypeFromName(targetPath));
        }
        catch (IOException e) {
            throw new BaseException("byclaw.fs.file.copy.failed", e);
        }
    }

    private InputStream read(FsSpaceType spaceType, String path) {
        if (spaceType == FsSpaceType.USER) {
            return userFS.read(path);
        }
        return resourceFS.read(path);
    }

    private boolean delete(FsSpaceType spaceType, String path) {
        if (spaceType == FsSpaceType.USER) {
            userFS.init();
            return Boolean.TRUE.equals(userFS.delete(path));
        }
        resourceFS.init();
        return Boolean.TRUE.equals(resourceFS.delete(path));
    }

    private List<String> list(FsSpaceType spaceType, String path) {
        return list(spaceType, path, null);
    }

    private List<String> list(FsSpaceType spaceType, String path, Integer maxDepth) {
        if (spaceType == FsSpaceType.USER) {
            return userFS.list(path, maxDepth);
        }
        return resourceFS.list(path, maxDepth);
    }

    private void streamFile(FsSpaceType spaceType, String path, OutputStream outputStream) throws IOException {
        try (InputStream inputStream = read(spaceType, path)) {
            if (inputStream == null) {
                throw new BaseException("byclaw.fs.file.not.exist");
            }
            IOUtils.copy(inputStream, outputStream);
        }
    }

    private MultipartFile adaptContentType(MultipartFile file, String path, String contentType) {
        if (file == null) {
            throw new BaseException("byclaw.fs.upload.file.not.empty");
        }
        String resolvedContentType = StringUtils.defaultIfBlank(contentType, file.getContentType());
        if (StringUtils.isBlank(resolvedContentType) || StringUtils.equals(resolvedContentType, file.getContentType())) {
            return file;
        }
        // Spring MultipartFile 的 contentType 不可直接改，只有调用方显式覆盖时才重新包装一次。
        try {
            return new MultipartFileUtil(file.getName(), fileNameOf(path), resolvedContentType, file.getBytes());
        }
        catch (IOException e) {
            throw new BaseException("byclaw.fs.upload.file.read.failed", e);
        }
    }

    private void ensureTargetWritable(FsSpaceType spaceType, String targetPath, boolean overwrite) {
        if (overwrite) {
            return;
        }
        if (existsExactPath(spaceType, targetPath)) {
            throw new BaseException("byclaw.fs.target.path.exists");
        }
    }

    private boolean existsExactPath(FsSpaceType spaceType, String path) {
        List<String> paths = list(spaceType, path);
        // list(prefix) 可能返回子路径，覆盖判断必须命中完全相同的对象路径。
        return paths.stream().anyMatch(item -> Objects.equals(normalizePath(item), path));
    }

    private boolean hasNonMarkerContent(List<String> paths, String directoryPath) {
        String marker = markerPath(directoryPath);
        return paths.stream().anyMatch(path -> !StringUtils.equals(path, marker) && !StringUtils.endsWith(path, "/"));
    }

    private void addFailedItem(FsDirectoryRenameResultVo result, String sourcePath, String targetPath, String stage,
        Exception e) {
        FsDirectoryRenameFailedItemVo failedItem = new FsDirectoryRenameFailedItemVo();
        failedItem.setSourcePath(sourcePath);
        failedItem.setTargetPath(targetPath);
        failedItem.setStage(stage);
        failedItem.setErrorMessage(e.getMessage());
        result.getFailedItems().add(failedItem);
        result.setFailed(result.getFailed() + 1);
    }

    private FsFileMetadataVo toFileMetadataVo(FsSpaceType spaceType, Long resourceId, String path, FileMetadata metadata) {
        FsFileMetadataVo vo = new FsFileMetadataVo();
        vo.setSpaceType(spaceType.name());
        vo.setResourceId(resourceId);
        vo.setPath(path);
        vo.setFileName(fileNameOf(path));
        if (metadata != null) {
            vo.setFileName(StringUtils.defaultIfBlank(metadata.getFileName(), vo.getFileName()));
            vo.setFileSize(metadata.getFileSize());
            vo.setContentType(metadata.getContentType());
            vo.setChecksum(metadata.getFileMd5());
            vo.setBucketName(metadata.getBucketName());
            vo.setStorageType(metadata.getStorageType());
        }
        return vo;
    }

    private String normalizeFilePath(FsSpaceType spaceType, String path) {
        String normalized = normalizeSpacePath(spaceType, path);
        if (StringUtils.endsWith(normalized, "/")) {
            throw new BaseException("byclaw.fs.file.path.cannot.end.with.slash");
        }
        return normalized;
    }

    private String normalizeDirectoryPath(FsSpaceType spaceType, String path) {
        String normalized = normalizeSpacePath(spaceType, path);
        return StringUtils.endsWith(normalized, "/") ? normalized : normalized + "/";
    }

    private String normalizeDirectoryPath(String path) {
        return normalizeDirectoryPath(null, path);
    }

    private String normalizeSpacePath(FsSpaceType spaceType, String path) {
        String normalized = normalizePath(path);
        if (spaceType != FsSpaceType.USER) {
            return normalized;
        }
        return removeUserStoragePrefix(normalized);
    }

    private String removeUserStoragePrefix(String normalizedPath) {
        String currentUserCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(currentUserCode)) {
            throw new BaseException("byclaw.fs.user.not.login");
        }
        String userBucketRoot = "/" + UserBucketNameResolver.buildUserBucketName(currentUserCode) + USER_FS_ROOT;
        if (StringUtils.equals(normalizedPath, userBucketRoot)) {
            return "/";
        }
        if (StringUtils.startsWith(normalizedPath, userBucketRoot + "/")) {
            // 外部可能传 /byclaw-{userCode}/by/...，内部交给 UserFS 时只保留语义路径。
            return normalizedPath.substring(userBucketRoot.length());
        }
        if (StringUtils.equals(normalizedPath, USER_FS_ROOT)) {
            return "/";
        }
        if (StringUtils.startsWith(normalizedPath, USER_FS_ROOT + "/")) {
            return normalizedPath.substring(USER_FS_ROOT.length());
        }
        if (StringUtils.startsWith(normalizedPath, USER_BUCKET_PREFIX)
            && (StringUtils.contains(normalizedPath, USER_FS_ROOT + "/")
                || StringUtils.endsWith(normalizedPath, USER_FS_ROOT))) {
            throw new BaseException("byclaw.fs.user.path.prefix.invalid");
        }
        return normalizedPath;
    }

    private String normalizePath(String path) {
        if (StringUtils.isBlank(path)) {
            throw new BaseException("byclaw.fs.file.path.not.empty");
        }
        String normalized = path.trim().replace('\\', '/').replaceAll("/+", "/");
        if (!StringUtils.startsWith(normalized, "/")) {
            normalized = "/" + normalized;
        }
        for (String part : normalized.split("/")) {
            if (StringUtils.equals(part, "..")) {
                // 禁止向上跳目录，避免通过 ../ 访问调用方声明空间之外的对象。
                throw new BaseException("byclaw.fs.file.path.contains.traversal");
            }
        }
        return normalized;
    }

    private String markerPath(String directoryPath) {
        return normalizeDirectoryPath(directoryPath) + DIRECTORY_MARKER;
    }

    private String fileNameOf(String path) {
        String normalized = StringUtils.removeEnd(StringUtils.defaultString(path), "/");
        int slashIndex = normalized.lastIndexOf('/');
        return slashIndex >= 0 ? normalized.substring(slashIndex + 1) : normalized;
    }

    private <T> T runAsUserCode(String userCode, Callable<T> callable) {
        if (StringUtils.isBlank(userCode)) {
            return callUnchecked(callable);
        }
        LoginInfo originalLoginInfo = CurrentUserHolder.getLoginInfo();
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode(userCode.trim());
        CurrentUserHolder.setLoginInfo(loginInfo);
        try {
            return callUnchecked(callable);
        }
        finally {
            restoreLoginInfo(originalLoginInfo);
        }
    }

    private <T> T callUnchecked(Callable<T> callable) {
        try {
            return callable.call();
        }
        catch (RuntimeException e) {
            throw e;
        }
        catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private void restoreLoginInfo(LoginInfo originalLoginInfo) {
        if (originalLoginInfo == null) {
            CurrentUserHolder.clearLoginInfo();
            return;
        }
        CurrentUserHolder.setLoginInfo(originalLoginInfo);
    }

    public static class FsDownload {

        private final String fileName;

        private final String contentType;

        private final StreamingResponseBody body;

        public FsDownload(String fileName, String contentType, StreamingResponseBody body) {
            this.fileName = fileName;
            this.contentType = contentType;
            this.body = body;
        }

        public String getFileName() {
            return fileName;
        }

        public String getContentType() {
            return contentType;
        }

        public StreamingResponseBody getBody() {
            return body;
        }
    }
}
