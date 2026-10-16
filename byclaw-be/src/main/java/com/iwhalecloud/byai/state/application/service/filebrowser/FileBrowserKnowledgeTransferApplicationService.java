package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.feign.request.knowledge.Folder;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.dto.resource.DatasetBuild;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.manager.qo.resource.DirAndFileQo;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.common.util.MultipartFileUtil;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserSaveToKnowledgeRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserSaveToKnowledgeVo;

/**
 * 文件模块内容保存到知识库。
 */
@Service
public class FileBrowserKnowledgeTransferApplicationService {

    private final FileBrowserApplicationService fileBrowserService;

    private final DatasetApplicationService datasetApplicationService;

    private final SsResourceService resourceService;

    private final AuthApplicationService authService;

    public FileBrowserKnowledgeTransferApplicationService(FileBrowserApplicationService fileBrowserService,
        DatasetApplicationService datasetApplicationService, SsResourceService resourceService,
        AuthApplicationService authService) {
        this.fileBrowserService = fileBrowserService;
        this.datasetApplicationService = datasetApplicationService;
        this.resourceService = resourceService;
        this.authService = authService;
    }

    public FileBrowserSaveToKnowledgeVo saveToKnowledge(String userCode, FileBrowserSaveToKnowledgeRequest request)
        throws IOException {
        return transfer(userCode, request, false, false);
    }

    /** 个人知识库入口：校验归属和管理权限，按需构建本次成功导入的文件。 */
    public FileBrowserSaveToKnowledgeVo saveToPersonalKnowledge(String userCode,
        FileBrowserSaveToKnowledgeRequest request) throws IOException {
        validateRequest(request);
        SsResource target = resourceService.findById(request.getTargetResourceId());
        if (target == null || Integer.valueOf(-1).equals(target.getResourceStatus())
            || !(OwnerType.PERSONAL.equals(target.getOwnerType()) || OwnerType.PERSONAL_DEFAULT.equals(target.getOwnerType()))
            || !java.util.Arrays.asList("KG_DOC", "KG_QA", "KG_TERM").contains(target.getResourceBizType())) {
            throw new IllegalArgumentException(I18nUtil.get("filebrowser.personal.knowledge.invalid"));
        }
        if (!authService.hasResourceManagePermission(target)) {
            throw new IllegalArgumentException(I18nUtil.get("user.permission.nopermission"));
        }
        String sourcePath = normalizeFileBrowserPath(request.getSourcePath());
        String parent = ensureFileBrowserDirectoryPath(getParentKnowledgeDirectory(sourcePath));
        FileBrowserItemVo source = fileBrowserService.listForTransfer(userCode, request.getResourceId(), parent).stream()
            .filter(item -> sourcePath.equals(normalizeFileBrowserPath(item.getPath())))
            .findFirst().orElseThrow(() -> new IllegalArgumentException(
                I18nUtil.get("filebrowser.personal.source.unavailable")));
        request.setSourceDir(source.isDir());
        return transfer(userCode, request, true, !Boolean.FALSE.equals(request.getBuildAfterSave()));
    }

    private FileBrowserSaveToKnowledgeVo transfer(String userCode, FileBrowserSaveToKnowledgeRequest request,
        boolean personalKnowledge, boolean buildAfterSave) throws IOException {
        validateRequest(request);

        FileBrowserSaveToKnowledgeVo result = new FileBrowserSaveToKnowledgeVo();
        result.setResourceId(request.getResourceId());
        result.setTargetResourceId(request.getTargetResourceId());
        result.setSourcePath(normalizeFileBrowserPath(request.getSourcePath()));

        String targetDirectoryPath = normalizeKnowledgeDirectoryPath(request.getTargetDirectoryPath());
        if (Boolean.TRUE.equals(request.getSourceDir())) {
            String sourceFolderName = getLastPathName(result.getSourcePath());
            targetDirectoryPath = joinKnowledgePath(targetDirectoryPath, sourceFolderName);
            if (ensureKnowledgeFolder(request.getTargetResourceId(), getParentKnowledgeDirectory(targetDirectoryPath),
                sourceFolderName)) {
                result.setCreatedFolderCount(result.getCreatedFolderCount() + 1);
            }
            copyDirectory(userCode, request, ensureFileBrowserDirectoryPath(result.getSourcePath()),
                targetDirectoryPath, result, personalKnowledge, buildAfterSave);
        }
        else {
            copyFile(userCode, request, result.getSourcePath(), targetDirectoryPath, result, buildAfterSave);
        }
        result.setTargetDirectoryPath(targetDirectoryPath);
        return result;
    }

    private void copyDirectory(String userCode, FileBrowserSaveToKnowledgeRequest request, String sourceDirectoryPath,
        String targetDirectoryPath, FileBrowserSaveToKnowledgeVo result, boolean personalKnowledge,
        boolean buildAfterSave) throws IOException {
        if (sourceDirectoryPath.split("/").length > 100) {
            throw new IllegalArgumentException(I18nUtil.get("filebrowser.personal.source.depth.exceeded"));
        }
        List<FileBrowserItemVo> children = personalKnowledge
            ? fileBrowserService.listForTransfer(userCode, request.getResourceId(), sourceDirectoryPath)
            : fileBrowserService.list(userCode, request.getResourceId(), sourceDirectoryPath);
        for (FileBrowserItemVo child : children) {
            try {
                if (child.isDir()) {
                    String childTargetDirectoryPath = joinKnowledgePath(targetDirectoryPath, child.getName());
                    if (ensureKnowledgeFolder(request.getTargetResourceId(), targetDirectoryPath, child.getName())) {
                        result.setCreatedFolderCount(result.getCreatedFolderCount() + 1);
                    }
                    copyDirectory(userCode, request, ensureFileBrowserDirectoryPath(child.getPath()),
                        childTargetDirectoryPath, result, personalKnowledge, buildAfterSave);
                }
                else {
                    copyFile(userCode, request, normalizeFileBrowserPath(child.getPath()), targetDirectoryPath, result, buildAfterSave);
                }
            } catch (IOException | RuntimeException ex) {
                if (!personalKnowledge) throw ex;
                result.getFailedItems().add(failedItem(child.getPath(), ex));
            }
        }
    }

    private void copyFile(String userCode, FileBrowserSaveToKnowledgeRequest request, String sourceFilePath,
        String targetDirectoryPath, FileBrowserSaveToKnowledgeVo result, boolean buildAfterSave) throws IOException {
        String fileName = getLastPathName(sourceFilePath);
        try (InputStream inputStream = fileBrowserService.download(userCode, request.getResourceId(), sourceFilePath)) {
            MultipartFile multipartFile = new MultipartFileUtil("files", fileName, null, inputStream);
            UploadResult uploadResult = datasetApplicationService.uploadFiles(new MultipartFile[] {
                multipartFile
            }, request.getTargetResourceId(), targetDirectoryPath, fileName,
                Boolean.TRUE.equals(request.getProcessFrontMatter()), Boolean.TRUE.equals(request.getOverwrite()),
                false, Collections.emptyMap());
            result.setUploadedFileCount(result.getUploadedFileCount() + uploadResult.getUploadItems().size());
            result.getFailedItems().addAll(uploadResult.getFailedItems());
            result.getPostProcessErrors().addAll(uploadResult.getPostProcessErrors());
            for (UploadItem uploadItem : uploadResult.getUploadItems()) {
                result.getUploadItems().add(uploadItem);
                if (!buildAfterSave || Boolean.FALSE.equals(uploadItem.getSuccess())) continue;
                try {
                    if (StringUtils.isBlank(uploadItem.getFilePath())) {
                        throw new IllegalArgumentException(I18nUtil.get("filebrowser.personal.build.path.missing"));
                    }
                    DatasetBuild build = new DatasetBuild();
                    build.setResourceId(request.getTargetResourceId());
                    build.setDirectoryPath(uploadItem.getFilePath());
                    datasetApplicationService.build(build, Collections.emptyMap());
                    result.setBuildSubmittedCount(result.getBuildSubmittedCount() + 1);
                } catch (RuntimeException ex) {
                    result.getBuildFailedItems().add(failedItem(uploadItem.getFilePath(), ex));
                }
            }
        }
    }

    private UploadItem failedItem(String path, Exception exception) {
        UploadItem item = new UploadItem();
        item.setFilePath(path);
        item.setSuccess(false);
        item.setError(StringUtils.defaultIfBlank(exception.getMessage(), exception.getClass().getSimpleName()));
        return item;
    }

    private boolean ensureKnowledgeFolder(Long resourceId, String parentDirectoryPath, String folderName) {
        String normalizedParentPath = normalizeKnowledgeDirectoryPath(parentDirectoryPath);
        if (knowledgeFolderExists(resourceId, normalizedParentPath, folderName)) {
            return false;
        }

        Folder folder = new Folder();
        folder.setResourceId(resourceId);
        folder.setDirectoryPath(normalizedParentPath);
        folder.setDirectoryName(folderName);
        folder.setDirectoryDescription("");
        try {
            datasetApplicationService.createFolder(folder, Collections.emptyMap());
            return true;
        }
        catch (RuntimeException ex) {
            if (knowledgeFolderExists(resourceId, normalizedParentPath, folderName)) {
                return false;
            }
            throw ex;
        }
    }

    private boolean knowledgeFolderExists(Long resourceId, String parentDirectoryPath, String folderName) {
        DirAndFileQo query = new DirAndFileQo();
        query.setResourceId(resourceId);
        query.setDirectoryPath(parentDirectoryPath);
        return datasetApplicationService.queryDirAndFileByLevel(query).stream()
            .anyMatch(item -> "directory".equalsIgnoreCase(item.getType()) && folderName.equals(item.getName()));
    }

    private void validateRequest(FileBrowserSaveToKnowledgeRequest request) {
        if (request == null) {
            throw new IllegalArgumentException(I18nUtil.get("filebrowser.personal.request.required"));
        }
        if (request.getResourceId() == null) {
            throw new IllegalArgumentException(I18nUtil.get("filebrowser.personal.resource.required"));
        }
        if (request.getTargetResourceId() == null) {
            throw new IllegalArgumentException(I18nUtil.get("filebrowser.personal.target.required"));
        }
        if (StringUtils.isBlank(request.getSourcePath())) {
            throw new IllegalArgumentException(I18nUtil.get("filebrowser.personal.source.path.required"));
        }
    }

    private String normalizeFileBrowserPath(String path) {
        String normalizedPath = StringUtils.defaultIfBlank(path, "/").trim().replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.contains(normalizedPath, "..")) {
            throw new IllegalArgumentException(I18nUtil.get("filebrowser.personal.path.invalid", path));
        }
        if (!normalizedPath.startsWith("/")) {
            normalizedPath = "/" + normalizedPath;
        }
        if (normalizedPath.length() > 1) {
            normalizedPath = StringUtils.removeEnd(normalizedPath, "/");
        }
        return normalizedPath;
    }

    private String ensureFileBrowserDirectoryPath(String path) {
        String normalizedPath = normalizeFileBrowserPath(path);
        return normalizedPath.endsWith("/") ? normalizedPath : normalizedPath + "/";
    }

    private String normalizeKnowledgeDirectoryPath(String path) {
        String normalizedPath = StringUtils.defaultIfBlank(path, "/").trim().replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.contains(normalizedPath, "..")) {
            throw new IllegalArgumentException(I18nUtil.get("filebrowser.personal.path.invalid", path));
        }
        if (!normalizedPath.startsWith("/")) {
            normalizedPath = "/" + normalizedPath;
        }
        if (normalizedPath.length() > 1) {
            normalizedPath = StringUtils.removeEnd(normalizedPath, "/");
        }
        return normalizedPath;
    }

    private String joinKnowledgePath(String parentDirectoryPath, String name) {
        String parent = normalizeKnowledgeDirectoryPath(parentDirectoryPath);
        String segment = StringUtils.strip(StringUtils.defaultString(name).replace('\\', '/'), "/");
        if (StringUtils.isBlank(segment) || StringUtils.contains(segment, "..") || StringUtils.contains(segment, "/")) {
            throw new IllegalArgumentException(I18nUtil.get("filebrowser.personal.directory.invalid", name));
        }
        if ("/".equals(parent)) {
            return "/" + segment;
        }
        return parent + "/" + segment;
    }

    private String getParentKnowledgeDirectory(String directoryPath) {
        String normalizedPath = normalizeKnowledgeDirectoryPath(directoryPath);
        int lastSlash = normalizedPath.lastIndexOf('/');
        if (lastSlash <= 0) {
            return "/";
        }
        return normalizedPath.substring(0, lastSlash);
    }

    private String getLastPathName(String path) {
        String normalizedPath = normalizeFileBrowserPath(path);
        int lastSlash = normalizedPath.lastIndexOf('/');
        String name = lastSlash >= 0 ? normalizedPath.substring(lastSlash + 1) : normalizedPath;
        if (StringUtils.isBlank(name)) {
            throw new IllegalArgumentException("路径名称不能为空: " + path);
        }
        return name;
    }
}
