package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.feign.request.knowledge.Folder;
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

    public FileBrowserKnowledgeTransferApplicationService(FileBrowserApplicationService fileBrowserService,
        DatasetApplicationService datasetApplicationService) {
        this.fileBrowserService = fileBrowserService;
        this.datasetApplicationService = datasetApplicationService;
    }

    public FileBrowserSaveToKnowledgeVo saveToKnowledge(String userCode, FileBrowserSaveToKnowledgeRequest request)
        throws IOException {
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
                targetDirectoryPath, result);
        }
        else {
            copyFile(userCode, request, result.getSourcePath(), targetDirectoryPath, result);
        }
        result.setTargetDirectoryPath(targetDirectoryPath);
        return result;
    }

    private void copyDirectory(String userCode, FileBrowserSaveToKnowledgeRequest request, String sourceDirectoryPath,
        String targetDirectoryPath, FileBrowserSaveToKnowledgeVo result) throws IOException {
        List<FileBrowserItemVo> children = fileBrowserService.list(userCode, request.getResourceId(),
            sourceDirectoryPath);
        for (FileBrowserItemVo child : children) {
            if (child.isDir()) {
                String childTargetDirectoryPath = joinKnowledgePath(targetDirectoryPath, child.getName());
                if (ensureKnowledgeFolder(request.getTargetResourceId(), targetDirectoryPath, child.getName())) {
                    result.setCreatedFolderCount(result.getCreatedFolderCount() + 1);
                }
                copyDirectory(userCode, request, ensureFileBrowserDirectoryPath(child.getPath()),
                    childTargetDirectoryPath, result);
            }
            else {
                copyFile(userCode, request, normalizeFileBrowserPath(child.getPath()), targetDirectoryPath, result);
            }
        }
    }

    private void copyFile(String userCode, FileBrowserSaveToKnowledgeRequest request, String sourceFilePath,
        String targetDirectoryPath, FileBrowserSaveToKnowledgeVo result) throws IOException {
        String fileName = getLastPathName(sourceFilePath);
        try (InputStream inputStream = fileBrowserService.download(userCode, request.getResourceId(), sourceFilePath)) {
            MultipartFile multipartFile = new MultipartFileUtil("files", fileName, null, inputStream);
            UploadResult uploadResult = datasetApplicationService.uploadFiles(new MultipartFile[] {
                multipartFile
            }, request.getTargetResourceId(), targetDirectoryPath, fileName,
                Boolean.TRUE.equals(request.getProcessFrontMatter()), Boolean.TRUE.equals(request.getOverwrite()),
                false);
            result.setUploadedFileCount(result.getUploadedFileCount() + uploadResult.getUploadItems().size());
            for (UploadItem uploadItem : uploadResult.getUploadItems()) {
                result.getUploadItems().add(uploadItem);
            }
        }
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
            datasetApplicationService.createFolder(folder);
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
            throw new IllegalArgumentException("请求参数不能为空");
        }
        if (request.getResourceId() == null) {
            throw new IllegalArgumentException("resourceId is required");
        }
        if (request.getTargetResourceId() == null) {
            throw new IllegalArgumentException("targetResourceId is required");
        }
        if (StringUtils.isBlank(request.getSourcePath())) {
            throw new IllegalArgumentException("sourcePath is required");
        }
    }

    private String normalizeFileBrowserPath(String path) {
        String normalizedPath = StringUtils.defaultIfBlank(path, "/").trim().replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.contains(normalizedPath, "..")) {
            throw new IllegalArgumentException("非法路径: " + path);
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
            throw new IllegalArgumentException("非法路径: " + path);
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
            throw new IllegalArgumentException("非法目录名称: " + name);
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
