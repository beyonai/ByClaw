package com.iwhalecloud.byai.state.interfaces.controller.filebrowser;

import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.exception.StorageQuotaExceededException;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.filebrowser.FileBrowserApplicationService;
import com.iwhalecloud.byai.state.application.service.filebrowser.FileBrowserKnowledgeTransferApplicationService;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserCopyRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserDeleteRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserListRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserMoveRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserRenameRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserSaveToKnowledgeRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserSearchRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserSaveToKnowledgeVo;

/**
 * 文件浏览器控制器
 * 提供文件列表、上传、下载、删除、重命名、移动、搜索、文件夹创建及打包下载等REST API接口。
 * 文件存储基于MinIO对象存储，按用户隔离bucket。
 *
 * @author liweto
 * @date 2026-06-04
 */
@RestController
@RequestMapping("/fileBrowser")
public class FileBrowserController {

    @Autowired
    private FileBrowserApplicationService fileBrowserService;

    @Autowired
    private FileBrowserKnowledgeTransferApplicationService knowledgeTransferApplicationService;

    /**
     * 获取指定目录下的文件和文件夹列表
     *
     * @param request 包含resourceId和目录路径
     * @return 文件列表
     */
    @PostMapping("/list")
    public ResponseUtil list(@RequestBody FileBrowserListRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        String path = StringUtils.defaultIfBlank(request.getPath(), "/");
        List<FileBrowserItemVo> items = fileBrowserService.list(userCode, request.getResourceId(), path);
        return ResponseUtil.successResponse(items);
    }

    /**
     * 获取资源的默认工作空间路径
     *
     * @param resourceId 资源ID
     * @return 默认路径
     */
    @GetMapping("/defaultPath")
    public ResponseUtil defaultPath(@RequestParam("resourceId") Long resourceId) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (resourceId == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        String defaultPath = fileBrowserService.getDefaultPath(resourceId);
        return ResponseUtil.successResponse(defaultPath);
    }

    /**
     * 上传文件到指定目录
     *
     * @param files 待上传文件数组
     * @param resourceId 资源ID
     * @param path 目标目录路径
     * @return 上传结果
     */
    @PostMapping("/upload")
    public ResponseUtil upload(
        @RequestParam("files") MultipartFile[] files,
        @RequestParam("resourceId") Long resourceId,
        @RequestParam(value = "path", defaultValue = "/") String path) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (resourceId == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (files == null || files.length == 0) {
            return ResponseUtil.fail("请选择要上传的文件");
        }
        try {
            fileBrowserService.upload(userCode, resourceId, path, files);
            return ResponseUtil.successResponse();
        } catch (StorageQuotaExceededException e) {
            throw e;
        } catch (Exception e) {
            return ResponseUtil.fail("上传失败: " + e.getMessage());
        }
    }

    /**
     * 保存文件或文件夹到知识库。文件夹会递归创建知识库目录并上传子级文件。
     *
     * @param request 源文件模块路径与目标知识库目录
     * @return 保存结果
     */
    @PostMapping("/saveToKnowledge")
    public ResponseUtil<FileBrowserSaveToKnowledgeVo> saveToKnowledge(
        @RequestBody FileBrowserSaveToKnowledgeRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        try {
            FileBrowserSaveToKnowledgeVo result =
                knowledgeTransferApplicationService.saveToKnowledge(userCode, request);
            return ResponseUtil.successResponse("已保存到知识库", result);
        }
        catch (Exception e) {
            return ResponseUtil.fail("保存到知识库失败: " + e.getMessage());
        }
    }

    /**
     * 下载单个文件
     *
     * @param resourceId 资源ID
     * @param path 文件相对路径
     * @return 文件流
     */
    @GetMapping("/download")
    public ResponseEntity<InputStreamResource> download(
        @RequestParam("resourceId") Long resourceId,
        @RequestParam("path") String path) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode) || resourceId == null || StringUtils.isBlank(path)) {
            return ResponseEntity.badRequest().build();
        }
        try {
            InputStream inputStream = fileBrowserService.download(userCode, resourceId, path);
            String fileName = path.contains("/") ? path.substring(path.lastIndexOf('/') + 1) : path;
            String encodedFileName = URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");

            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + encodedFileName)
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(new InputStreamResource(inputStream));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    /**
     * 批量删除文件或文件夹
     *
     * @param request 包含resourceId和待删除路径列表
     * @return 删除结果
     */
    @PostMapping("/delete")
    public ResponseUtil delete(@RequestBody FileBrowserDeleteRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (request.getPaths() == null || request.getPaths().isEmpty()) {
            return ResponseUtil.fail("paths is required");
        }
        try {
            fileBrowserService.delete(userCode, request.getResourceId(), request.getPaths());
            return ResponseUtil.successResponse();
        } catch (Exception e) {
            return ResponseUtil.fail("删除失败: " + e.getMessage());
        }
    }

    /**
     * 重命名文件或文件夹
     *
     * @param request 包含resourceId、源路径和新名称
     * @return 重命名结果
     */
    @PostMapping("/rename")
    public ResponseUtil rename(@RequestBody FileBrowserRenameRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (StringUtils.isBlank(request.getSourcePath())) {
            return ResponseUtil.fail("sourcePath is required");
        }
        if (StringUtils.isBlank(request.getNewName())) {
            return ResponseUtil.fail("newName is required");
        }
        try {
            fileBrowserService.rename(userCode, request.getResourceId(), request.getSourcePath(), request.getNewName());
            return ResponseUtil.successResponse();
        } catch (Exception e) {
            return ResponseUtil.fail("重命名失败: " + e.getMessage());
        }
    }

    /**
     * 批量移动文件或文件夹到目标目录
     *
     * @param request 包含resourceId、源路径列表和目标目录
     * @return 移动结果
     */
    @PostMapping("/move")
    public ResponseUtil move(@RequestBody FileBrowserMoveRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (request.getSourcePaths() == null || request.getSourcePaths().isEmpty()) {
            return ResponseUtil.fail("sourcePaths is required");
        }
        if (StringUtils.isBlank(request.getTargetDirectory())) {
            return ResponseUtil.fail("targetDirectory is required");
        }
        try {
            fileBrowserService.move(userCode, request.getResourceId(), request.getSourcePaths(),
                request.getTargetDirectory());
            return ResponseUtil.successResponse();
        } catch (Exception e) {
            return ResponseUtil.fail("移动失败: " + e.getMessage());
        }
    }

    /**
     * 复制文件或文件夹到目标目录
     *
     * @param request 包含resourceId、源路径和目标目录
     * @return 复制结果
     */
    @PostMapping("/copy")
    public ResponseUtil copy(@RequestBody FileBrowserCopyRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (StringUtils.isBlank(request.getSourcePath())) {
            return ResponseUtil.fail("sourcePath is required");
        }
        if (StringUtils.isBlank(request.getTargetDirectory())) {
            return ResponseUtil.fail("targetDirectory is required");
        }
        try {
            fileBrowserService.copy(userCode, request.getResourceId(), request.getSourcePath(),
                request.getTargetDirectory());
            return ResponseUtil.successResponse();
        } catch (Exception e) {
            return ResponseUtil.fail("复制失败: " + e.getMessage());
        }
    }

    /**
     * 创建文件夹
     *
     * @param request 包含resourceId和文件夹路径
     * @return 创建结果
     */
    @PostMapping("/createFolder")
    public ResponseUtil createFolder(@RequestBody FileBrowserListRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (StringUtils.isBlank(request.getPath())) {
            return ResponseUtil.fail("path is required");
        }
        try {
            fileBrowserService.createFolder(userCode, request.getResourceId(), request.getPath());
            return ResponseUtil.successResponse();
        } catch (Exception e) {
            return ResponseUtil.fail("创建文件夹失败: " + e.getMessage());
        }
    }

    /**
     * 幂等确保文件夹存在，主要用于共享文件夹、日志文件夹等系统入口。
     *
     * @param request 包含resourceId和文件夹路径
     * @return 处理结果
     */
    @PostMapping("/ensureFolder")
    public ResponseUtil ensureFolder(@RequestBody FileBrowserListRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (StringUtils.isBlank(request.getPath())) {
            return ResponseUtil.fail("path is required");
        }
        try {
            fileBrowserService.ensureFolder(userCode, request.getResourceId(), request.getPath());
            return ResponseUtil.successResponse();
        } catch (Exception e) {
            return ResponseUtil.fail("创建文件夹失败: " + e.getMessage());
        }
    }

    /**
     * 递归搜索文件和文件夹
     * 在指定目录下递归搜索名称包含关键词的文件和文件夹（忽略大小写）
     *
     * @param request 包含resourceId、搜索起始路径和关键词
     * @return 匹配的文件列表
     */
    @PostMapping("/search")
    public ResponseUtil search(@RequestBody FileBrowserSearchRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (StringUtils.isBlank(request.getKeyword())) {
            return ResponseUtil.fail("keyword is required");
        }
        String path = StringUtils.defaultIfBlank(request.getPath(), "/");
        List<FileBrowserItemVo> items = fileBrowserService.search(userCode, request.getResourceId(), path, request.getKeyword());
        return ResponseUtil.successResponse(items);
    }

    /**
     * 文件夹打包下载
     * 将指定文件夹下所有文件递归打包为zip格式流式下载
     *
     * @param resourceId 资源ID
     * @param path 文件夹相对路径
     * @return zip文件流
     */
    @GetMapping("/downloadFolder")
    public ResponseEntity<StreamingResponseBody> downloadFolder(
        @RequestParam("resourceId") Long resourceId,
        @RequestParam("path") String path) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode) || resourceId == null || StringUtils.isBlank(path)) {
            return ResponseEntity.badRequest().build();
        }
        try {
            String folderName = fileBrowserService.getFolderName(path);
            String encodedFileName = URLEncoder.encode(folderName + ".zip", StandardCharsets.UTF_8).replace("+", "%20");

            StreamingResponseBody body = outputStream -> fileBrowserService.downloadFolder(userCode, resourceId, path, outputStream);

            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + encodedFileName)
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(body);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }
}
